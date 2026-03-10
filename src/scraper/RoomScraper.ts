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
  building: string;
  floor: number;
  capacity: number | null;
  externalId: string; // "소회의실①_별관_3층" 형식
  available: boolean;
}

export interface SearchParams {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  floor?: number;
  building?: string; // 별관, 본관
}

/**
 * 마일 사이트의 예약 현황 페이지에서 회의실 정보/가용성을 스크래핑
 *
 * 사이트 구조:
 * - 가로 스크롤 가능한 타임그리드 (세로: 시간, 가로: 회의실)
 * - 각 회의실 컬럼 헤더: 이름 + 건물-층 + "상세 정보"
 * - 예약은 컬러 블록으로 표시 (회사명 + 시간)
 */
export class RoomScraper {
  /**
   * 특정 날짜의 회의실 목록과 가용성 조회
   */
  async searchAvailableRooms(params: SearchParams): Promise<RoomInfo[]> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();
      const start = Date.now();

      try {
        await siteAuth.navigateToBookingPage(page);

        // 날짜 설정
        await this.setDate(page, params.date);

        // 전체 회의실 목록 + 예약 현황 파싱
        const rooms = await this.parseRoomGrid(page, params);

        // 필터 적용
        let filtered = rooms;
        if (params.floor) {
          filtered = filtered.filter((r) => r.floor === params.floor);
        }
        if (params.building) {
          filtered = filtered.filter((r) => r.building === params.building);
        }

        logger.info('회의실 조회 완료', {
          duration_ms: Date.now() - start,
          total: rooms.length,
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

  /**
   * 전체 회의실 목록 조회 (가용성 무관)
   */
  async getAllRooms(): Promise<RoomInfo[]> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();

      try {
        await siteAuth.navigateToBookingPage(page);

        // 예약하기 버튼 클릭하여 회의실 선택 패널에서 전체 목록 추출
        const bookBtn = await page.$('button.button-solid-primary:has-text("예약하기")');
        if (!bookBtn) throw new Error('예약하기 버튼을 찾을 수 없습니다.');
        await bookBtn.click();
        await page.waitForTimeout(1500);

        // 회의실 선택 입력란 클릭하여 드롭다운 열기
        const roomSearch = await page.$(selectors.bookingForm.roomSearchInput);
        if (roomSearch) {
          await roomSearch.click();
          await page.waitForTimeout(1000);
        }

        // 회의실 목록 파싱 (드롭다운에서)
        const rooms = await page.evaluate(() => {
          const results: Array<{
            name: string;
            building: string;
            floor: number;
            capacity: number | null;
          }> = [];

          // 회의실 선택 드롭다운의 항목들 파싱
          // 라벨 형식: "건물 - N층 | M인"
          const doc = (globalThis as any).document;
          const items = doc.querySelectorAll('[class*="option"], [class*="item"], [class*="list"] > div');
          items.forEach((el: any) => {
            const text = el.textContent?.trim() || '';
            const match = text.match(/(별관|본관)\s*-\s*(\d+)층\s*\|\s*(\d+)인/);
            if (match) {
              const nameEl = el.querySelector('p, span, div');
              const name = nameEl?.textContent?.trim() || text;
              results.push({
                name,
                building: match[1],
                floor: parseInt(match[2], 10),
                capacity: parseInt(match[3], 10),
              });
            }
          });

          return results;
        });

        // 폼 닫기
        const closeBtn = await page.$('button:has-text("✕"), [class*="close"]');
        if (closeBtn) await closeBtn.click();

        return rooms.map((r, i) => ({
          id: `room_${i}`,
          name: r.name,
          building: r.building,
          floor: r.floor,
          capacity: r.capacity,
          externalId: `${r.name}_${r.building}_${r.floor}층`,
          available: true,
        }));
      } catch (error) {
        logger.error('전체 회의실 목록 조회 실패', { error: (error as Error).message });
        throw error;
      } finally {
        await page.close();
      }
    }, '전체 회의실 목록 조회');
  }

  /**
   * 캘린더에서 날짜 선택
   */
  private async setDate(page: Page, dateStr: string): Promise<void> {
    const [year, month, day] = dateStr.split('-').map(Number);

    // 날짜 표시 버튼 클릭하여 캘린더 열기
    const dateBtn = await page.$('button:has-text(".")');
    if (!dateBtn) return;

    // 현재 표시 날짜 읽기
    const currentDateText = await dateBtn.textContent();
    if (!currentDateText) return;

    // 이미 올바른 날짜면 스킵
    const dateFormatted = `${year}. ${String(month).padStart(2, '0')}. ${String(day).padStart(2, '0')}`;
    if (currentDateText.includes(dateFormatted)) return;

    // 날짜를 rdrDay 캘린더 버튼으로 선택
    // 먼저 올바른 달로 이동해야 함
    await dateBtn.click();
    await page.waitForTimeout(500);

    // 해당 날짜의 rdrDay 버튼 클릭 (rdrDayToday가 아닌 특정 날짜)
    const dayButton = await page.$(
      `button.rdrDay:not(.rdrDayPassive):not(.rdrDayDisabled) >> text="${day}"`,
    );
    if (dayButton) {
      await dayButton.click();
      await page.waitForTimeout(500);
    }
  }

  /**
   * 예약 현황 타임그리드에서 회의실 목록 + 가용성 파싱
   */
  private async parseRoomGrid(page: Page, params: SearchParams): Promise<RoomInfo[]> {
    const rooms: RoomInfo[] = [];
    const seenRooms = new Set<string>();

    // "상세 정보" 링크 기반으로 회의실 헤더 파싱
    const headers = await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const results: Array<{ name: string; location: string; colIndex: number }> = [];
      const allEls = Array.from((globalThis as any).document.querySelectorAll('*')) as any[];
      const detailEls = allEls.filter(
        (el: any) => el.textContent?.trim() === '상세 정보' && el.children.length === 0,
      );

      detailEls.forEach((el: any, idx: number) => {
        const parent = el.closest?.('div')?.parentElement;
        if (!parent) return;
        const texts = parent.innerText.split('\n').map((t: string) => t.trim()).filter(Boolean);
        if (texts.length >= 2) {
          results.push({
            name: texts[0],
            location: texts.find((t: string) => t.includes('층') && t.includes('-')) || texts[1],
            colIndex: idx,
          });
        }
      });
      return results;
    });

    // 중복 제거 (같은 방이 두 번 나옴 — DOM 구조상)
    for (const header of headers) {
      const key = `${header.name}_${header.location}`;
      if (seenRooms.has(key)) continue;
      seenRooms.add(key);

      const { building, floor } = this.parseLocation(header.location);

      // 가용성 체크: 해당 시간대에 예약 블록이 있는지 확인
      const available = await this.checkAvailability(
        page,
        header.colIndex,
        params.startTime,
        params.endTime,
      );

      rooms.push({
        id: `room_${rooms.length}`,
        name: header.name,
        building,
        floor,
        capacity: null, // 타임그리드에서는 수용인원 안보임
        externalId: `${header.name}_${building}_${floor}층`,
        available,
      });
    }

    return rooms;
  }

  /**
   * "별관 - 3층" → { building: "별관", floor: 3 }
   */
  private parseLocation(location: string): { building: string; floor: number } {
    const match = location.match(/(별관|본관)\s*-?\s*(\d+)\s*층/);
    if (match) {
      return { building: match[1], floor: parseInt(match[2], 10) };
    }
    return { building: '', floor: 0 };
  }

  /**
   * 특정 회의실 컬럼의 시간대에 예약이 없는지 확인
   * (간단한 휴리스틱: 해당 컬럼의 예약 블록 시간을 비교)
   */
  private async checkAvailability(
    _page: Page,
    _colIndex: number,
    _startTime: string,
    _endTime: string,
  ): Promise<boolean> {
    // TODO: 타임그리드에서 해당 컬럼의 예약 블록 시간과 요청 시간을 비교
    // 현재는 true 반환 (예약 시도 시 사이트에서 충돌 체크)
    return true;
  }
}

export const roomScraper = new RoomScraper();
