import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';
import { browserPool } from './BrowserPool';
import { siteAuth } from './SiteAuthenticator';
import { enqueueScraperTask } from '../utils/queue';
import { navigateToDate } from './DateNavigator';

const logger = createLogger('BookingExecutor');

const selectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'selectors.json'), 'utf-8'),
);

/** 예약 폼 슬라이드 패널의 X좌표 기준 (우측 패널 입력필드) */
const FORM_PANEL_X_MIN = 830;
/** 회의실 input은 폼 내 5번째 input (0-indexed: 4) */
const ROOM_INPUT_INDEX = 4;
/** 사이드바 네비게이션 X좌표 상한 */
const SIDEBAR_X_MAX = 250;

export interface BookingParams {
  roomName: string; // 회의실 이름 (예: "소회의실①")
  roomBuilding: string; // 건물 (예: "별관")
  roomFloor: number; // 층 (예: 3)
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  userName: string; // 예약자 이름 (메모에 기입)
  memo?: string; // 사유/용건
}

export interface BookingResult {
  success: boolean;
  externalBookingId?: string;
  errorMessage?: string;
}

/**
 * 마일 사이트의 예약 폼(슬라이드 패널)을 통해 회의실 예약 실행
 *
 * 플로우:
 * 1. 예약 현황 페이지에서 "예약하기" 버튼 클릭
 * 2. 슬라이드 패널에서 날짜/시간/회의실/메모 입력
 * 3. "예약하기" 제출 버튼 클릭
 */
export class BookingExecutor {
  async executeBooking(params: BookingParams): Promise<BookingResult> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();
      const start = Date.now();

      try {
        await siteAuth.navigateToBookingPage(page);

        // 1. 날짜 이동 (폼 열기 전에 — 폼이 해당 날짜를 자동 세팅)
        await navigateToDate(page, params.date);

        // 2. "예약하기" 버튼 클릭하여 예약 폼 열기 (evaluate로 오버레이 우회)
        await page.waitForSelector('button.button-solid-primary', { timeout: 10_000 });
        const bookBtnClicked = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const btns = Array.from(doc.querySelectorAll('button.button-solid-primary')) as any[];
          const btn = btns.find((b: any) => b.textContent?.includes('예약하기'));
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (!bookBtnClicked) throw new Error('예약하기 버튼을 찾을 수 없습니다.');
        await page.waitForTimeout(1500);

        // 3. 회의실 선택 (시간보다 먼저 — React controlled input은 변경 불가)
        await this.selectRoom(page, params.roomName, params.roomBuilding, params.roomFloor);

        // 4. 메모 입력 (예약자 + 사유)
        const memoInput = await page.$(selectors.bookingForm.memoTextarea);
        if (memoInput) {
          const memoText = params.memo
            ? `[${params.userName}] ${params.memo}`
            : `예약자: ${params.userName}`;
          await memoInput.fill(memoText);
        }

        // 5. 제출 버튼 활성화 대기 및 클릭 (evaluate로 오버레이 우회)
        await page.waitForTimeout(500);
        const submitClicked = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const btns = Array.from(doc.querySelectorAll('button.button-solid-primary')) as any[];
          const btn = btns.find((b: any) =>
            b.textContent?.includes('예약하기') && !b.classList.contains('button-solid-disabled'),
          );
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (!submitClicked) {
          throw new Error('예약하기 버튼이 활성화되지 않았습니다. 필수 항목을 확인하세요.');
        }

        // 6. 예약 완료 대기
        await page.waitForLoadState('networkidle', { timeout: 10_000 });
        await page.waitForTimeout(2000);

        // 예약 ID 생성 (사이트에서 별도 ID를 반환하지 않으므로 조합)
        const externalBookingId = `mile_${params.date}_${params.startTime}_${params.roomName}`;

        logger.info('예약 실행 성공', {
          duration_ms: Date.now() - start,
          room: `${params.roomName} (${params.roomBuilding} ${params.roomFloor}층)`,
          userName: params.userName,
          externalBookingId,
        });

        return {
          success: true,
          externalBookingId,
        };
      } catch (error) {
        await siteAuth.captureScreenshot(page, 'booking-failure');
        logger.error('예약 실행 실패', {
          duration_ms: Date.now() - start,
          error: (error as Error).message,
        });

        return {
          success: false,
          errorMessage: (error as Error).message,
        };
      } finally {
        await page.context().close();
      }
    }, `예약 실행 (${params.date} ${params.startTime}-${params.endTime} ${params.userName})`);
  }

  /**
   * 회의실 선택: 검색 입력 → 드롭다운에서 div.css-4d7k9p 항목 클릭
   * 드롭다운 텍스트 형식: "회의실 ①본관 - 7층 | 4인"
   */
  private async selectRoom(
    page: Page,
    roomName: string,
    building: string,
    floor: number,
  ): Promise<void> {
    // 폼 내 회의실 input (슬라이드 패널 영역의 input 중 ROOM_INPUT_INDEX번째)
    const roomInput = await page.evaluate(({ panelXMin, inputIdx }) => {
      const doc = (globalThis as any).document;
      const inputs = Array.from(doc.querySelectorAll('input.input')) as any[];
      const formInputs = inputs.filter((el: any) => el.getBoundingClientRect().x > panelXMin);
      return formInputs.length > inputIdx ? formInputs[inputIdx].getBoundingClientRect() : null;
    }, { panelXMin: FORM_PANEL_X_MIN, inputIdx: ROOM_INPUT_INDEX });

    if (roomInput) {
      await page.mouse.click(roomInput.x + roomInput.width / 2, roomInput.y + roomInput.height / 2);
      await page.waitForTimeout(1000);
    } else {
      // fallback: selector 기반
      const roomSearch = await page.$(selectors.bookingForm.roomSearchInput);
      if (!roomSearch) throw new Error('회의실 검색 필드를 찾을 수 없습니다.');
      await roomSearch.click();
      await page.waitForTimeout(1000);
    }

    // 드롭다운 항목(div.css-4d7k9p)에서 회의실명+건물+층으로 매칭
    const targetText = `${building} - ${floor}층`;
    const clicked = await page.evaluate(({ name, location }) => {
      const doc = (globalThis as any).document;
      const items = Array.from(doc.querySelectorAll('div.css-4d7k9p')) as any[];
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes(name) && text.includes(location)) {
          item.click();
          return true;
        }
      }
      // fallback: 층만 매칭
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes(location)) {
          item.click();
          return true;
        }
      }
      return false;
    }, { name: roomName, location: targetText });

    if (!clicked) {
      throw new Error(`회의실을 찾을 수 없습니다: ${roomName} (${targetText})`);
    }

    await page.waitForTimeout(500);
  }

  /**
   * 예약 취소: "나의 예약/참석" → 해당 예약 찾기 → "삭제하기" 클릭
   */
  async cancelBooking(
    externalBookingId: string,
    roomName: string,
    date: string,
    startTime: string,
  ): Promise<BookingResult> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();
      const start = Date.now();

      try {
        await siteAuth.ensureAuthenticated(page);

        // 나의 예약/참석 페이지로 이동 (사이드바 영역 내 요소)
        const navClicked = await page.evaluate((sidebarXMax) => {
          const doc = (globalThis as any).document;
          // 사이드바 내 네비게이션 링크를 타겟팅
          const navLinks = Array.from(doc.querySelectorAll('a, button, [role="menuitem"], span')) as any[];
          for (const el of navLinks) {
            if (el.textContent?.trim() === '나의 예약/참석' && el.getBoundingClientRect().x < sidebarXMax) {
              el.click();
              return true;
            }
          }
          return false;
        }, SIDEBAR_X_MAX);
        if (navClicked) {
          await page.waitForLoadState('networkidle', { timeout: 10_000 });
          await page.waitForTimeout(2000);
        }

        // 해당 예약 찾기 + 삭제 (evaluate 내에서 처리하여 오버레이 문제 회피)
        const found = await page.evaluate(({ targetRoom, targetTime }) => {
          const doc = (globalThis as any).document;
          const buttons = Array.from(doc.querySelectorAll('button')) as any[];
          const deleteButtons = buttons.filter((b: any) => b.textContent?.trim() === '삭제하기');

          for (const btn of deleteButtons) {
            // 부모 컨테이너에서 예약 정보 확인
            let container = btn.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!container) break;
              if (container.textContent && container.textContent.length > 50) break;
              container = container.parentElement;
            }
            const text = container?.textContent || '';
            if (text.includes(targetRoom) && text.includes(targetTime)) {
              btn.scrollIntoView({ behavior: 'instant', block: 'center' });
              btn.click();
              return true;
            }
          }
          return false;
        }, { targetRoom: roomName, targetTime: startTime });

        if (!found) {
          throw new Error(`예약을 찾을 수 없습니다: ${roomName} ${date} ${startTime}`);
        }

        await page.waitForTimeout(1000);

        // 확인 대화상자 처리 (evaluate로 클릭)
        await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const buttons = Array.from(doc.querySelectorAll('button')) as any[];
          const confirmBtn = buttons.find((b: any) => {
            const text = b.textContent?.trim();
            return text === '삭제' || text === '확인';
          });
          if (confirmBtn) confirmBtn.click();
        });
        await page.waitForLoadState('networkidle', { timeout: 10_000 });

        logger.info('예약 취소 성공', {
          duration_ms: Date.now() - start,
          externalBookingId,
        });

        return { success: true };
      } catch (error) {
        await siteAuth.captureScreenshot(page, 'cancel-failure');
        logger.error('예약 취소 실패', {
          duration_ms: Date.now() - start,
          error: (error as Error).message,
        });

        return {
          success: false,
          errorMessage: (error as Error).message,
        };
      } finally {
        await page.context().close();
      }
    }, `예약 취소 (${externalBookingId})`);
  }
}

export const bookingExecutor = new BookingExecutor();
