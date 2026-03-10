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

        // 1. "예약하기" 버튼 클릭하여 예약 폼 열기
        const newBookingBtn = await page.waitForSelector(
          'button.button-solid-primary:has-text("예약하기")',
          { timeout: 10_000 },
        );
        if (!newBookingBtn) throw new Error('예약하기 버튼을 찾을 수 없습니다.');
        await newBookingBtn.click();
        await page.waitForTimeout(1500);

        // 2. 날짜 설정
        await this.setBookingDate(page, params.date);

        // 3. 시간 설정
        await this.setBookingTime(page, params.startTime, params.endTime);

        // 4. 회의실 선택
        await this.selectRoom(page, params.roomName, params.roomBuilding, params.roomFloor);

        // 5. 메모 입력 (예약자 이름)
        const memoInput = await page.$(selectors.bookingForm.memoTextarea);
        if (memoInput) {
          await memoInput.fill(`예약자: ${params.userName}`);
        }

        // 6. 제출 버튼 활성화 대기 및 클릭
        await page.waitForTimeout(500);
        const submitBtn = await page.waitForSelector(
          'button.button-solid-primary:has-text("예약하기"):not(.button-solid-disabled)',
          { timeout: 5_000 },
        );
        if (!submitBtn) {
          throw new Error('예약하기 버튼이 활성화되지 않았습니다. 필수 항목을 확인하세요.');
        }
        await submitBtn.click();

        // 7. 예약 완료 대기
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
   * 예약 폼에서 날짜 설정
   * 날짜 입력란 클릭 → 캘린더에서 날짜 선택
   */
  private async setBookingDate(page: Page, dateStr: string): Promise<void> {
    const [year, month, day] = dateStr.split('-').map(Number);

    // 날짜 입력란 클릭
    const dateInputs = await page.$$('input.input');
    for (const input of dateInputs) {
      const value = await input.inputValue();
      // 날짜 형식 (YYYY. MM. DD)인 입력란 찾기
      if (value.match(/\d{4}\.\s*\d{2}\.\s*\d{2}/)) {
        await input.click();
        await page.waitForTimeout(500);

        // 캘린더에서 날짜 클릭
        // 캘린더가 올바른 월을 표시하는지 확인하고 내비게이션
        const dayBtn = await page.$(
          `button.rdrDay:not(.rdrDayPassive):not(.rdrDayDisabled) >> text="${day}"`,
        );
        if (dayBtn) {
          await dayBtn.click();
          await page.waitForTimeout(500);
        }
        break;
      }
    }
  }

  /**
   * 예약 폼에서 시작/종료 시간 설정
   * 시간 입력란을 클릭하고 시간 선택
   */
  private async setBookingTime(page: Page, startTime: string, endTime: string): Promise<void> {
    const timeInputs = await page.$$('input.input');
    const timeFields: Array<{ el: typeof timeInputs[0]; value: string }> = [];

    for (const input of timeInputs) {
      const value = await input.inputValue();
      // HH:mm 형식인 입력란 찾기
      if (value.match(/^\d{1,2}:\d{2}$/)) {
        timeFields.push({ el: input, value });
      }
    }

    // 시작 시간 (첫 번째 시간 필드)
    if (timeFields.length >= 1) {
      await timeFields[0].el.click();
      await page.waitForTimeout(300);
      await timeFields[0].el.fill('');
      await timeFields[0].el.type(startTime);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
    }

    // 종료 시간 (두 번째 시간 필드)
    if (timeFields.length >= 2) {
      await timeFields[1].el.click();
      await page.waitForTimeout(300);
      await timeFields[1].el.fill('');
      await timeFields[1].el.type(endTime);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
    }
  }

  /**
   * 회의실 선택: 검색 입력 → 드롭다운에서 클릭
   */
  private async selectRoom(
    page: Page,
    roomName: string,
    building: string,
    floor: number,
  ): Promise<void> {
    const roomSearch = await page.$(selectors.bookingForm.roomSearchInput);
    if (!roomSearch) throw new Error('회의실 검색 필드를 찾을 수 없습니다.');

    // 회의실명으로 검색
    await roomSearch.click();
    await roomSearch.fill(roomName);
    await page.waitForTimeout(1000);

    // 드롭다운에서 매칭되는 회의실 클릭
    // 건물-층 정보로 정확한 회의실 선택
    const targetLocation = `${building} - ${floor}층`;
    const option = await page.$(`:has-text("${targetLocation}")`);
    if (option) {
      await option.click();
      await page.waitForTimeout(500);
    } else {
      // 검색 결과의 첫 번째 항목 클릭
      const firstOption = await page.$('[class*="option"], [class*="item"]');
      if (firstOption) {
        await firstOption.click();
      } else {
        throw new Error(
          `회의실을 찾을 수 없습니다: ${roomName} (${targetLocation})`,
        );
      }
    }
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

        // 나의 예약/참석 페이지로 이동
        const myBookingsNav = await page.$('p:has-text("나의 예약/참석")');
        if (myBookingsNav) {
          await myBookingsNav.click();
          await page.waitForLoadState('networkidle', { timeout: 10_000 });
          await page.waitForTimeout(2000);
        }

        // 해당 예약 찾기 (날짜, 시간, 회의실 명으로 매칭)
        const deleteButtons = await page.$$('button:has-text("삭제하기")');

        // 각 삭제 버튼의 근처 정보를 확인하여 맞는 예약 찾기
        let found = false;
        for (const btn of deleteButtons) {
          const parent = await btn.evaluateHandle((el) => {
            // 삭제 버튼의 부모 컨테이너에서 예약 정보 확인
            let container = el.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!container) break;
              if (container.textContent && container.textContent.length > 50) {
                return container;
              }
              container = container.parentElement;
            }
            return container || el.parentElement;
          });

          if (parent) {
            const text = await parent.evaluate((el: any) => el.textContent || '');
            // 회의실명과 시간으로 매칭
            if (text.includes(roomName) && text.includes(startTime)) {
              await btn.click();
              await page.waitForTimeout(1000);

              // 확인 대화상자 처리
              const confirmBtn = await page.$('button:has-text("확인"), button:has-text("삭제")');
              if (confirmBtn) {
                await confirmBtn.click();
                await page.waitForLoadState('networkidle', { timeout: 10_000 });
              }

              found = true;
              break;
            }
          }
        }

        if (!found) {
          throw new Error(
            `예약을 찾을 수 없습니다: ${roomName} ${date} ${startTime}`,
          );
        }

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
