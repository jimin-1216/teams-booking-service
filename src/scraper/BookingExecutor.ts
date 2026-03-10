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
  roomExternalId: string;
  date: string;
  startTime: string;
  endTime: string;
  userName: string; // 예약자 이름 (비고란에 기입)
}

export interface BookingResult {
  success: boolean;
  externalBookingId?: string;
  errorMessage?: string;
}

export class BookingExecutor {
  async executeBooking(params: BookingParams): Promise<BookingResult> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();
      const start = Date.now();

      try {
        await siteAuth.ensureAuthenticated(page);

        // 예약 페이지로 이동
        const bookingNav = await page.$(selectors.navigation.bookingPage);
        if (bookingNav) {
          await bookingNav.click();
          await page.waitForLoadState('networkidle');
        }

        // 날짜/시간 설정
        const dateInput = await page.waitForSelector(selectors.booking.dateSelector, {
          timeout: 10_000,
        });
        if (dateInput) await dateInput.fill(params.date);

        const startTimeInput = await page.$(selectors.booking.timeStartSelector);
        if (startTimeInput) await startTimeInput.selectOption(params.startTime);

        const endTimeInput = await page.$(selectors.booking.timeEndSelector);
        if (endTimeInput) await endTimeInput.selectOption(params.endTime);

        await page.waitForSelector(selectors.booking.roomListContainer, {
          timeout: 10_000,
        });

        // 특정 회의실의 예약 버튼 클릭 (CSS 셀렉터 인젝션 방지)
        const sanitizedId = params.roomExternalId.replace(/[^\w-]/g, '');
        const roomElement = await page.$(`[data-id="${sanitizedId}"], #${sanitizedId}`);
        if (!roomElement) {
          throw new Error(`회의실을 찾을 수 없습니다: ${params.roomExternalId}`);
        }

        const bookBtn = await roomElement.$(selectors.booking.bookButton);
        if (!bookBtn) {
          throw new Error('예약 버튼을 찾을 수 없습니다. 이미 예약된 시간일 수 있습니다.');
        }

        await bookBtn.click();
        await page.waitForLoadState('networkidle');

        // 비고란에 예약자 이름 기입
        const memoInput = await page.$(selectors.booking.memoInput);
        if (memoInput) {
          await memoInput.fill(`예약자: ${params.userName}`);
        }

        // 예약 확인 버튼 클릭
        const confirmBtn = await page.waitForSelector(selectors.booking.confirmButton, {
          timeout: 5_000,
        });
        if (!confirmBtn) {
          throw new Error('예약 확인 버튼을 찾을 수 없습니다.');
        }

        await confirmBtn.click();

        // 예약 성공 확인 대기
        await page.waitForLoadState('networkidle');

        // 예약 ID 추출 (URL 또는 DOM에서)
        const currentUrl = page.url();
        const bookingIdMatch = currentUrl.match(/booking[_-]?id[=\/](\w+)/i);
        const externalBookingId = bookingIdMatch?.[1] || `ext_${Date.now()}`;

        logger.info('예약 실행 성공', {
          duration_ms: Date.now() - start,
          roomExternalId: params.roomExternalId,
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

  async cancelBooking(externalBookingId: string): Promise<BookingResult> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();
      const start = Date.now();

      try {
        await siteAuth.ensureAuthenticated(page);

        // 내 예약 페이지로 이동
        const myBookingsNav = await page.$(selectors.navigation.myBookingsPage);
        if (myBookingsNav) {
          await myBookingsNav.click();
          await page.waitForLoadState('networkidle');
        }

        await page.waitForSelector(selectors.myBookings.listContainer, {
          timeout: 10_000,
        });

        // 해당 예약 찾기 및 취소 버튼 클릭
        const bookingItems = await page.$$(selectors.myBookings.bookingItem);

        let found = false;
        for (const item of bookingItems) {
          const itemId = await item.getAttribute('data-id');
          if (itemId === externalBookingId) {
            const cancelBtn = await item.$(selectors.myBookings.cancelButton);
            if (cancelBtn) {
              await cancelBtn.click();
              await page.waitForLoadState('networkidle');
              found = true;
              break;
            }
          }
        }

        if (!found) {
          throw new Error(`예약을 찾을 수 없습니다: ${externalBookingId}`);
        }

        // 취소 확인 대화상자 처리
        const confirmBtn = await page.$(selectors.booking.confirmButton);
        if (confirmBtn) {
          await confirmBtn.click();
          await page.waitForLoadState('networkidle');
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
