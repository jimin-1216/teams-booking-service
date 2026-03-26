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

        // 2. "예약하기" 버튼 클릭하여 예약 폼 열기
        //    React 렌더링 대기 후 버튼 탐색
        await page.waitForTimeout(3000);

        // 디버그: 현재 페이지의 모든 버튼 상태 로깅
        const btnDebug = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const btns = Array.from(doc.querySelectorAll('button')) as any[];
          return btns
            .filter((b: any) => b.textContent?.trim().length > 0 && b.textContent.trim().length < 30)
            .map((b: any) => {
              const rect = b.getBoundingClientRect();
              return {
                text: b.textContent?.trim(),
                class: b.className?.substring(0, 60),
                x: Math.round(rect.x), y: Math.round(rect.y),
                w: Math.round(rect.width), h: Math.round(rect.height),
              };
            });
        });
        logger.info('DEBUG: 페이지 버튼 목록', { buttons: btnDebug, url: page.url() });

        const openFormClicked = await page.evaluate((panelX: number) => {
          const doc = (globalThis as any).document;
          const isVisible = (el: any) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          // 1차: button.button-solid-primary 중 "예약하기" (visible, not disabled)
          //   폼 열기 버튼은 상단 바(y < 150)에 있고, 제출 버튼은 폼 패널 내(y > 400)
          const primaryBtns = Array.from(doc.querySelectorAll('button.button-solid-primary')) as any[];
          const btn = primaryBtns.find((b: any) => {
            const rect = b.getBoundingClientRect();
            return b.textContent?.includes('예약하기')
              && !b.classList.contains('button-solid-disabled')
              && isVisible(b)
              && rect.y < 150;
          });
          if (btn) { btn.click(); return 'primary'; }
          // 2차: visible "예약하기" 버튼 (disabled 제외)
          const allBtns = Array.from(doc.querySelectorAll('button')) as any[];
          const fallback = allBtns.find((b: any) =>
            b.textContent?.trim() === '예약하기'
            && !b.classList.contains('button-solid-disabled')
            && isVisible(b),
          );
          if (fallback) { fallback.click(); return 'fallback'; }
          return null;
        }, FORM_PANEL_X_MIN);
        if (!openFormClicked) throw new Error('예약하기 버튼을 찾을 수 없습니다.');
        logger.info('예약하기 폼 열기', { method: openFormClicked });
        await page.waitForTimeout(2000);

        // 폼 열림 검증: 폼 패널 내 input 수 확인
        const formState = await page.evaluate((panelXMin: number) => {
          const doc = (globalThis as any).document;
          const inputs = Array.from(doc.querySelectorAll('input.input')) as any[];
          const formInputs = inputs.filter((el: any) => el.getBoundingClientRect().x > panelXMin);
          return {
            totalInputs: inputs.length,
            formInputs: formInputs.length,
            formInputValues: formInputs.map((el: any) => ({
              placeholder: el.placeholder,
              value: el.value,
              x: Math.round(el.getBoundingClientRect().x),
            })),
          };
        }, FORM_PANEL_X_MIN);
        logger.info('DEBUG: 폼 상태', formState);

        if (formState.formInputs < 3) {
          // 폼이 안 열렸으면 재시도
          logger.warn('폼이 열리지 않음, 재시도');
          await page.evaluate(() => {
            const doc = (globalThis as any).document;
            const btns = Array.from(doc.querySelectorAll('button')) as any[];
            const btn = btns.find((b: any) => {
              const r = b.getBoundingClientRect();
              return b.textContent?.includes('예약하기')
                && !b.classList.contains('button-solid-disabled')
                && r.width > 0 && r.y < 150;
            });
            if (btn) btn.click();
          });
          await page.waitForTimeout(2000);
        }

        await siteAuth.captureScreenshot(page, 'debug-after-form-open');

        // 3. 회의실 선택
        await this.selectRoom(page, params.roomName, params.roomBuilding, params.roomFloor);
        await siteAuth.captureScreenshot(page, 'debug-after-room-select');

        // 4. 메모 입력 (evaluate로 직접 value 설정)
        const memoText = params.memo
          ? `[${params.userName}] ${params.memo}`
          : `예약자: ${params.userName}`;
        await page.evaluate(({ sel, text }) => {
          const doc = (globalThis as any).document;
          const textarea = doc.querySelector(sel) as any;
          if (textarea) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              (globalThis as any).HTMLTextAreaElement.prototype, 'value',
            )?.set;
            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(textarea, text);
            } else {
              textarea.value = text;
            }
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { sel: selectors.bookingForm.memoTextarea, text: memoText });

        // 5. 제출 버튼 클릭 — 폼 패널 내(y > 400)의 "예약하기"
        //    회의실 선택 후 제출 버튼 활성화 대기 (최대 5초)
        await page.waitForTimeout(500);

        // 제출 버튼 활성화 대기
        let submitReady = false;
        for (let i = 0; i < 10; i++) {
          submitReady = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            const btns = Array.from(doc.querySelectorAll('button.button-solid-primary')) as any[];
            return btns.some((b: any) => {
              const rect = b.getBoundingClientRect();
              return b.textContent?.includes('예약하기')
                && !b.classList.contains('button-solid-disabled')
                && rect.y > 400 && rect.width > 0;
            });
          });
          if (submitReady) break;
          await page.waitForTimeout(500);
        }

        // 디버그: 제출 전 폼 내 예약하기 버튼 상태
        const submitBtnState = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const btns = Array.from(doc.querySelectorAll('button.button-solid-primary')) as any[];
          return btns
            .filter((b: any) => b.textContent?.includes('예약하기'))
            .map((b: any) => {
              const rect = b.getBoundingClientRect();
              return {
                text: b.textContent?.trim(),
                disabled: b.classList.contains('button-solid-disabled'),
                x: Math.round(rect.x), y: Math.round(rect.y),
                w: Math.round(rect.width), h: Math.round(rect.height),
                class: b.className?.substring(0, 80),
              };
            });
        });
        logger.info('DEBUG: 제출 버튼 상태', { buttons: submitBtnState, submitReady });

        await siteAuth.captureScreenshot(page, 'debug-before-submit');
        const submitClicked = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const btns = Array.from(doc.querySelectorAll('button.button-solid-primary')) as any[];
          // 폼 패널 내(y > 400) 활성화된 "예약하기" 버튼만 클릭
          const btn = btns.find((b: any) => {
            const rect = b.getBoundingClientRect();
            return b.textContent?.includes('예약하기')
              && !b.classList.contains('button-solid-disabled')
              && rect.y > 400 && rect.width > 0;
          });
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (!submitClicked) {
          throw new Error('예약하기 제출 버튼이 활성화되지 않았습니다. 회의실 선택 또는 시간 설정을 확인하세요.');
        }

        // 6. 예약 완료 대기 + 결과 검증
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
        await page.waitForTimeout(2000);
        await siteAuth.captureScreenshot(page, 'debug-after-submit');

        // 에러 메시지 확인 (사이트가 에러 토스트/다이얼로그를 띄울 수 있음)
        const pageError = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          // 에러 토스트/알림 확인
          const toasts = Array.from(doc.querySelectorAll('[class*="toast"], [class*="alert"], [class*="error"], [role="alert"]')) as any[];
          for (const t of toasts) {
            const text = t.textContent?.trim();
            if (text && text.length > 0 && text.length < 200) return text;
          }
          return null;
        });
        if (pageError) {
          logger.warn('예약 후 페이지 메시지 감지', { message: pageError });
        }

        const externalBookingId = `mile_${params.date}_${params.startTime}_${params.roomName}`;

        logger.info('예약 실행 완료', {
          duration_ms: Date.now() - start,
          room: `${params.roomName} (${params.roomBuilding} ${params.roomFloor}층)`,
          userName: params.userName,
          externalBookingId,
          pageError,
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
    // 폼 내 회의실 input 클릭 (evaluate로 오버레이 우회)
    const roomInputClicked = await page.evaluate(({ panelXMin, inputIdx, fallbackSel }) => {
      const doc = (globalThis as any).document;
      const inputs = Array.from(doc.querySelectorAll('input.input')) as any[];
      const formInputs = inputs.filter((el: any) => el.getBoundingClientRect().x > panelXMin);
      if (formInputs.length > inputIdx) {
        formInputs[inputIdx].click();
        formInputs[inputIdx].focus();
        return true;
      }
      // fallback: selector 기반
      const fallback = doc.querySelector(fallbackSel) as any;
      if (fallback) { fallback.click(); fallback.focus(); return true; }
      return false;
    }, { panelXMin: FORM_PANEL_X_MIN, inputIdx: ROOM_INPUT_INDEX, fallbackSel: selectors.bookingForm.roomSearchInput });
    if (!roomInputClicked) throw new Error('회의실 검색 필드를 찾을 수 없습니다.');
    await page.waitForTimeout(1500);

    // 디버그: 드롭다운 항목 확인
    const dropdownDebug = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const items = Array.from(doc.querySelectorAll('div.css-4d7k9p')) as any[];
      return {
        count: items.length,
        items: items.slice(0, 10).map((el: any) => ({
          text: el.textContent?.trim().substring(0, 50),
          visible: el.getBoundingClientRect().width > 0,
        })),
      };
    });
    logger.info('DEBUG: 회의실 드롭다운', dropdownDebug);

    // 드롭다운 항목(div.css-4d7k9p)에서 회의실명+건물+층으로 매칭
    const targetText = `${building} - ${floor}층`;
    const clickResult = await page.evaluate(({ name, location }) => {
      const doc = (globalThis as any).document;
      const items = Array.from(doc.querySelectorAll('div.css-4d7k9p')) as any[];
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes(name) && text.includes(location)) {
          item.click();
          return { matched: text.trim().substring(0, 50), method: 'name+location' };
        }
      }
      // fallback: 층만 매칭
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes(location)) {
          item.click();
          return { matched: text.trim().substring(0, 50), method: 'location-only' };
        }
      }
      return null;
    }, { name: roomName, location: targetText });

    if (!clickResult) {
      throw new Error(`회의실을 찾을 수 없습니다: ${roomName} (${targetText})`);
    }
    logger.info('회의실 선택 완료 (폼)', { ...clickResult, target: `${roomName} (${targetText})` });

    await page.waitForTimeout(1000);
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
          await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
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
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });

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
