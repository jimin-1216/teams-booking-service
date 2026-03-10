import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';
import { browserPool } from './BrowserPool';
import { siteAuth } from './SiteAuthenticator';
import { enqueueScraperTask } from '../utils/queue';

const logger = createLogger('RoomScraper');

const selectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'selectors.json'), 'utf-8'),
);

export interface RoomInfo {
  id: string;
  name: string;
  floor: number;
  capacity: number | null;
  externalId: string;
  available: boolean;
}

export interface SearchParams {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  floor?: number; // 2, 7, 8
}

export class RoomScraper {
  async searchAvailableRooms(params: SearchParams): Promise<RoomInfo[]> {
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

        // 날짜 선택
        const dateInput = await page.waitForSelector(selectors.booking.dateSelector, {
          timeout: 10_000,
        });
        if (dateInput) {
          await dateInput.fill(params.date);
        }

        // 시간 선택
        const startTimeInput = await page.$(selectors.booking.timeStartSelector);
        if (startTimeInput) {
          await startTimeInput.selectOption(params.startTime);
        }

        const endTimeInput = await page.$(selectors.booking.timeEndSelector);
        if (endTimeInput) {
          await endTimeInput.selectOption(params.endTime);
        }

        // 층 선택 (옵션)
        if (params.floor) {
          const floorSelect = await page.$(selectors.booking.floorSelector);
          if (floorSelect) {
            await floorSelect.selectOption(String(params.floor));
          }
        }

        // 검색/조회 대기
        await page.waitForSelector(selectors.booking.roomListContainer, {
          timeout: 10_000,
        });

        // 회의실 목록 파싱
        const bookingSel = selectors.booking;
        const rooms = await page.$$eval(
          bookingSel.roomItem,
          (elements, sel) => {
            return elements.map((el, index) => {
              const name = el.querySelector(sel.roomName)?.textContent?.trim() || `회의실 ${index + 1}`;
              const capacityText = el.querySelector(sel.roomCapacity)?.textContent?.trim();
              const capacity = capacityText ? parseInt(capacityText.replace(/\D/g, ''), 10) : null;
              const isAvailable = !!el.querySelector(sel.roomAvailable);

              return {
                name,
                capacity: isNaN(capacity as number) ? null : capacity,
                available: isAvailable,
                externalId: el.getAttribute('data-id') || el.getAttribute('id') || `room-${index}`,
              };
            });
          },
          bookingSel as { roomName: string; roomCapacity: string; roomAvailable: string },
        );

        // 층 정보 추출 (이름 기반 추정 또는 data 속성)
        const result: RoomInfo[] = rooms.map((room) => ({
          id: `room_${room.externalId}`,
          name: room.name,
          floor: this.extractFloor(room.name),
          capacity: room.capacity,
          externalId: room.externalId,
          available: room.available,
        }));

        // 층 필터 적용
        const filtered = params.floor
          ? result.filter((r) => r.floor === params.floor)
          : result;

        logger.info('회의실 조회 완료', {
          duration_ms: Date.now() - start,
          total: result.length,
          available: filtered.filter((r) => r.available).length,
          floor: params.floor || 'all',
        });

        return filtered.filter((r) => r.available);
      } catch (error) {
        await siteAuth.captureScreenshot(page, 'search-failure');
        logger.error('회의실 조회 실패', {
          duration_ms: Date.now() - start,
          error: (error as Error).message,
        });
        throw error;
      } finally {
        await page.close();
      }
    }, `회의실 조회 (${params.date} ${params.startTime}-${params.endTime})`);
  }

  private extractFloor(roomName: string): number {
    // 이름에서 층 정보 추출: "2층 회의실A" → 2
    const match = roomName.match(/(\d+)\s*층/);
    if (match) return parseInt(match[1], 10);

    // 영문 패턴: "2F Room A" → 2
    const matchEn = roomName.match(/(\d+)\s*[fF]/);
    if (matchEn) return parseInt(matchEn[1], 10);

    return 0; // 알 수 없음
  }
}

export const roomScraper = new RoomScraper();
