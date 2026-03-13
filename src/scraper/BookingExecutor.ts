import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';
import { browserPool } from './BrowserPool';
import { siteAuth } from './SiteAuthenticator';
import { enqueueScraperTask } from '../utils/queue';

const logger = createLogger('BookingExecutor');

const selectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'selectors.json'), 'utf-8'),
);

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
        await this.navigateToDate(page, params.date);

        // 2. "예약하기" 버튼 클릭하여 예약 폼 열기
        const newBookingBtn = await page.waitForSelector(
          'button.button-solid-primary:has-text("예약하기")',
          { timeout: 10_000 },
        );
        if (!newBookingBtn) throw new Error('예약하기 버튼을 찾을 수 없습니다.');
        await newBookingBtn.click();
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

        // 5. 제출 버튼 활성화 대기 및 클릭
        await page.waitForTimeout(500);
        const submitBtn = await page.waitForSelector(
          'button.button-solid-primary:has-text("예약하기"):not(.button-solid-disabled)',
          { timeout: 5_000 },
        );
        if (!submitBtn) {
          throw new Error('예약하기 버튼이 활성화되지 않았습니다. 필수 항목을 확인하세요.');
        }
        await submitBtn.click();

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
        await page.close();
      }
    }, `예약 실행 (${params.date} ${params.startTime}-${params.endTime} ${params.userName})`);
  }

  /**
   * 예약 현황 페이지에서 날짜 이동 (폼 열기 전에 호출)
   * 상단 날짜 네비게이션의 > < 버튼을 좌표 기반으로 클릭
   * 폼을 열면 현재 표시 중인 날짜가 자동 세팅됨
   */
  private async navigateToDate(page: Page, dateStr: string): Promise<void> {
    const [year, month, day] = dateStr.split('-').map(Number);
    const targetFormatted = `${year}. ${String(month).padStart(2, '0')}. ${String(day).padStart(2, '0')}`;

    // 현재 표시된 날짜 확인
    const getCurrentDate = async (): Promise<string> => {
      return page.evaluate(() => {
        const doc = (globalThis as any).document;
        const btn = doc.querySelector('button.button-text.secondary.enabled.medium');
        return btn?.textContent?.trim() || '';
      });
    };

    const currentDate = await getCurrentDate();
    if (currentDate.includes(targetFormatted)) return;

    // 날짜 버튼 위치 분석 → > < 버튼 좌표 계산
    const navInfo = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const results: Array<{ text: string; x: number; y: number; w: number; h: number; hasSvg: boolean }> = [];
      doc.querySelectorAll('button, [role="button"]').forEach((btn: any) => {
        const rect = btn.getBoundingClientRect();
        if (rect.y > 75 && rect.y < 135 && rect.width > 0) {
          results.push({
            text: btn.textContent?.trim()?.substring(0, 30) || '',
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
            hasSvg: !!btn.querySelector('svg'),
          });
        }
      });
      return results;
    });

    const dateBtn = navInfo.find(b => b.text?.includes(String(year)));
    const nextBtns = navInfo.filter(b => b.hasSvg && b.x > (dateBtn?.x || 500));
    const prevBtns = navInfo.filter(b => b.hasSvg && b.x < (dateBtn?.x || 500));

    // 목표 날짜와 현재 날짜의 차이 계산
    const currentParts = currentDate.match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})/);
    if (!currentParts) return;

    const currentD = new Date(+currentParts[1], +currentParts[2] - 1, +currentParts[3]);
    const targetD = new Date(year, month - 1, day);
    const diffDays = Math.round((targetD.getTime() - currentD.getTime()) / (1000 * 60 * 60 * 24));

    const isForward = diffDays > 0;
    const btn = isForward ? nextBtns[0] : prevBtns[prevBtns.length - 1];
    if (!btn) return;

    for (let i = 0; i < Math.abs(diffDays); i++) {
      await page.mouse.click(btn.x + btn.w / 2, btn.y + btn.h / 2);
      await page.waitForTimeout(300);
    }

    // 날짜 변경 확인
    await page.waitForTimeout(500);
    const newDate = await getCurrentDate();
    logger.info('날짜 이동', { from: currentDate, to: newDate, target: targetFormatted });
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
    // 폼 내 회의실 input (x > 830인 input 중 5번째)
    const roomInput = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const inputs = Array.from(doc.querySelectorAll('input.input')) as any[];
      const formInputs = inputs.filter((el: any) => el.getBoundingClientRect().x > 830);
      return formInputs.length >= 5 ? formInputs[4].getBoundingClientRect() : null;
    });

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

        // 나의 예약/참석 페이지로 이동 (사이드바에서 x < 250인 요소)
        const navClicked = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const els = Array.from(doc.querySelectorAll('*')) as any[];
          for (const el of els) {
            if (el.textContent?.trim() === '나의 예약/참석' && el.getBoundingClientRect().x < 250) {
              el.click();
              return true;
            }
          }
          return false;
        });
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
        await page.close();
      }
    }, `예약 취소 (${externalBookingId})`);
  }
}

export const bookingExecutor = new BookingExecutor();
