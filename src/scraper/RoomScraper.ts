import { Page } from 'playwright';
import { createLogger } from '../utils/logger';
import { browserPool } from './BrowserPool';
import { siteAuth } from './SiteAuthenticator';
import { enqueueScraperTask } from '../utils/queue';
import { navigateToDate } from './DateNavigator';

const logger = createLogger('RoomScraper');

/** 예약 가능 층 (본관만) */
const BOOKABLE_FLOORS = [2, 7, 8];
const BUILDING = '본관';

export interface RoomInfo {
  id: string;
  name: string;
  building: string;
  floor: number;
  capacity: number | null;
  externalId: string; // "회의실 ①_본관_7층"
  available: boolean;
}

export interface SearchParams {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  floor?: number;
  building?: string;
}

/**
 * 마일 사이트 예약 현황 페이지에서 회의실 조회
 *
 * 전략: 건물 필터(본관) + 층 필터(2/7/8) → 타임그리드 파싱 + 가로 스크롤
 * 예약 블록의 시간 텍스트로 가용성 판단
 */
export class RoomScraper {
  /**
   * 특정 날짜/시간대의 빈 회의실 조회
   */
  async searchAvailableRooms(params: SearchParams): Promise<RoomInfo[]> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();
      const start = Date.now();

      try {
        await siteAuth.navigateToBookingPage(page);
        await navigateToDate(page, params.date);

        const floors = params.floor ? [params.floor] : BOOKABLE_FLOORS;
        const allRooms: RoomInfo[] = [];

        for (const floor of floors) {
          await this.applyFilter(page, BUILDING, floor);
          const rooms = await this.scrollAndCollectRooms(page, params, floor);
          allRooms.push(...rooms);
        }

        // 필터 리셋 (다른곳 클릭)
        await page.click('body', { position: { x: 100, y: 500 } });

        const available = allRooms.filter((r) => r.available);

        logger.info('회의실 조회 완료', {
          duration_ms: Date.now() - start,
          total: allRooms.length,
          available: available.length,
          floors,
        });

        return available;
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
   * 전체 예약 가능 회의실 목록 (가용성 무관)
   */
  async getAllRooms(): Promise<RoomInfo[]> {
    return enqueueScraperTask(async () => {
      const page = await browserPool.getPage();

      try {
        await siteAuth.navigateToBookingPage(page);

        const allRooms: RoomInfo[] = [];

        for (const floor of BOOKABLE_FLOORS) {
          await this.applyFilter(page, BUILDING, floor);
          const rooms = await this.scrollAndCollectRooms(page, null, floor);
          allRooms.push(...rooms);
        }

        await page.click('body', { position: { x: 100, y: 500 } });

        logger.info('전체 회의실 목록 조회', { count: allRooms.length });
        return allRooms;
      } catch (error) {
        logger.error('전체 회의실 목록 조회 실패', { error: (error as Error).message });
        throw error;
      } finally {
        await page.close();
      }
    }, '전체 회의실 목록 조회');
  }

  /**
   * 건물 + 층 필터 적용
   * 회의실 위치 클릭 → 건물 선택 → 층 선택
   */
  private async applyFilter(page: Page, building: string, floor: number): Promise<void> {
    // 확인 다이얼로그가 떠 있으면 닫기 (이전 예약 폼 잔여)
    await this.dismissConfirmDialog(page);
    await siteAuth.captureScreenshot(page, 'debug-before-filter');

    // 회의실 위치 필터 클릭
    const locationFilter = await page.$("input[placeholder='회의실 위치']");
    if (!locationFilter) {
      await siteAuth.captureScreenshot(page, 'debug-no-filter-input');
      throw new Error('회의실 위치 필터를 찾을 수 없습니다.');
    }

    await locationFilter.click();
    await page.waitForTimeout(800);
    await siteAuth.captureScreenshot(page, 'debug-filter-dropdown');

    // 건물 선택 (드롭다운 왼쪽: css-y4bpjy 클래스)
    try {
      await page.locator(`div.css-y4bpjy:has-text("${building}")`).click({ timeout: 5000 });
    } catch (error) {
      await siteAuth.captureScreenshot(page, 'debug-building-click-failed');
      // 다이얼로그 다시 시도
      await this.dismissConfirmDialog(page);
      // force: true로 재시도
      await page.locator(`div.css-y4bpjy:has-text("${building}")`).click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(500);

    // 층 선택 (드롭다운 오른쪽)
    await page.locator(`text=${floor}층`).first().click();
    await page.waitForTimeout(1500);
  }

  /**
   * 타임그리드에서 가로 스크롤하며 회의실 + 예약 현황 수집
   */
  private async scrollAndCollectRooms(
    page: Page,
    params: SearchParams | null,
    targetFloor: number,
  ): Promise<RoomInfo[]> {
    // 스크롤 초기화
    await page.evaluate(() => {
      const doc = (globalThis as any).document;
      for (const div of Array.from(doc.querySelectorAll('div')) as any[]) {
        if (div.scrollWidth > div.clientWidth + 50
          && div.getBoundingClientRect().y > 150
          && div.getBoundingClientRect().height > 200) {
          div.scrollLeft = 0;
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    const allRooms = new Map<string, RoomInfo>();
    let attempts = 0;

    while (attempts < 30) {
      // 현재 보이는 회의실 헤더 파싱
      const headers = await this.parseVisibleHeaders(page);

      for (const h of headers) {
        const { building, floor } = this.parseLocation(h.location);
        // 타겟 층만 수집 (필터 적용 후에도 다른 층 데이터가 섞일 수 있음)
        if (floor !== targetFloor) continue;

        const key = `${h.name}_${building}_${floor}`;
        if (allRooms.has(key)) continue;

        let available = true;
        if (params) {
          available = await this.checkColumnAvailability(
            page, h.colIndex, params.startTime, params.endTime,
          );
        }

        allRooms.set(key, {
          id: `room_${building}_${floor}_${h.name}`.replace(/\s/g, ''),
          name: h.name,
          building,
          floor,
          capacity: null,
          externalId: `${h.name}_${building}_${floor}층`,
          available,
        });
      }

      // 가로 스크롤
      const canScroll = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        for (const div of Array.from(doc.querySelectorAll('div')) as any[]) {
          if (div.scrollWidth > div.clientWidth + 50
            && div.getBoundingClientRect().y > 150
            && div.getBoundingClientRect().height > 200) {
            const before = div.scrollLeft;
            div.scrollLeft += 400;
            return div.scrollLeft > before;
          }
        }
        return false;
      });

      if (!canScroll) break;
      await page.waitForTimeout(300);
      attempts++;
    }

    return Array.from(allRooms.values());
  }

  /**
   * 현재 화면에 보이는 회의실 헤더 파싱
   * "상세 정보" 링크 기반
   */
  private async parseVisibleHeaders(
    page: Page,
  ): Promise<Array<{ name: string; location: string; colIndex: number }>> {
    return page.evaluate(() => {
      const results: Array<{ name: string; location: string; colIndex: number }> = [];
      const doc = (globalThis as any).document;
      const allEls = Array.from(doc.querySelectorAll('*')) as any[];
      const detailEls = allEls.filter(
        (el: any) => el.textContent?.trim() === '상세 정보' && el.children.length === 0,
      );

      detailEls.forEach((el: any, idx: number) => {
        const parent = el.closest?.('div')?.parentElement;
        if (!parent) return;
        const texts = parent.innerText
          .split('\n')
          .map((t: string) => t.trim())
          .filter(Boolean);
        if (texts.length >= 2) {
          results.push({
            name: texts[0],
            location:
              texts.find((t: string) => t.includes('층') && t.includes('-')) || texts[1],
            colIndex: idx,
          });
        }
      });
      return results;
    });
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
   * 특정 회의실 컬럼의 예약 블록을 확인하여 시간대 가용성 판단
   *
   * 예약 블록 텍스트 형식: "HH:mm ~HH:mm" (예: "15:00 ~17:30")
   * 해당 컬럼 영역의 예약 블록 시간과 요청 시간이 겹치면 unavailable
   */
  private async checkColumnAvailability(
    page: Page,
    colIndex: number,
    startTime: string,
    endTime: string,
  ): Promise<boolean> {
    const bookingTimes = await page.evaluate(
      ({ colIdx }) => {
        const doc = (globalThis as any).document;
        const allEls = Array.from(doc.querySelectorAll('*')) as any[];
        const detailEls = allEls.filter(
          (el: any) => el.textContent?.trim() === '상세 정보' && el.children.length === 0,
        );

        const targetDetail = detailEls[colIdx];
        if (!targetDetail) return [];

        // 이 컬럼의 헤더 위치 기반으로 해당 컬럼 영역 계산
        const headerParent = targetDetail.closest?.('div')?.parentElement;
        if (!headerParent) return [];

        const headerRect = headerParent.getBoundingClientRect();
        const colLeft = headerRect.left;
        const colRight = headerRect.right;

        // 해당 컬럼 영역의 예약 블록에서 시간 텍스트 추출
        const timeTexts: string[] = [];
        const captionEls = doc.querySelectorAll('p.typo.caption02.bold, [class*="caption"]');
        captionEls.forEach((el: any) => {
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.trim() || '';
          // 해당 컬럼 영역 내에 있고 시간 형식인 요소
          if (
            rect.left >= colLeft - 10 &&
            rect.right <= colRight + 10 &&
            rect.top > headerRect.bottom &&
            text.match(/\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/)
          ) {
            timeTexts.push(text);
          }
        });

        return timeTexts;
      },
      { colIdx: colIndex },
    );

    // 시간 겹침 확인
    const reqStart = this.timeToMinutes(startTime);
    const reqEnd = this.timeToMinutes(endTime);

    for (const timeText of bookingTimes) {
      const match = timeText.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
      if (!match) continue;

      const bookStart = this.timeToMinutes(match[1]);
      const bookEnd = this.timeToMinutes(match[2]);

      // 겹치는지 확인: NOT (끝 <= 시작 OR 시작 >= 끝)
      if (!(reqEnd <= bookStart || reqStart >= bookEnd)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 예약 폼 확인 다이얼로그 ("예약하기를 통해 확정하지 않으시면...") 닫기
   */
  private async dismissConfirmDialog(page: Page): Promise<void> {
    try {
      // 여러 패턴으로 다이얼로그 버튼 탐색
      const selectors = [
        'button:has-text("확인")',
        'button:has-text("닫기")',
        'button:has-text("취소")',
        '[role="dialog"] button',
        '.modal button',
      ];
      for (const sel of selectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click({ force: true });
          await page.waitForTimeout(500);
          logger.info('다이얼로그 닫음', { selector: sel });
          return;
        }
      }
      // Escape 키로도 시도
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch {
      // 다이얼로그 없으면 무시
    }
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }
}

export const roomScraper = new RoomScraper();
