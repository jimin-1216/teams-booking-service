import { Page } from 'playwright';
import { createLogger } from '../utils/logger';

const logger = createLogger('DateNavigator');

/** 상단 날짜 네비게이션 영역의 Y좌표 범위 */
const NAV_AREA_Y_MIN = 75;
const NAV_AREA_Y_MAX = 135;

/** 날짜당 클릭 후 대기 시간 (ms) */
const CLICK_DELAY = 300;
const SETTLE_DELAY = 500;

interface NavButton {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hasSvg: boolean;
}

/**
 * 예약 현황 페이지 상단의 날짜 네비게이션 (< > 버튼)을 사용하여 날짜 이동
 * BookingExecutor와 RoomScraper에서 공통 사용
 */
export async function navigateToDate(page: Page, dateStr: string): Promise<void> {
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

  // 날짜 버튼 위치 분석 → < > 버튼 좌표 계산
  const navInfo = await page.evaluate(({ yMin, yMax }) => {
    const doc = (globalThis as any).document;
    const results: Array<{ text: string; x: number; y: number; w: number; h: number; hasSvg: boolean }> = [];
    doc.querySelectorAll('button, [role="button"]').forEach((btn: any) => {
      const rect = btn.getBoundingClientRect();
      if (rect.y > yMin && rect.y < yMax && rect.width > 0) {
        results.push({
          text: btn.textContent?.trim()?.substring(0, 30) || '',
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height),
          hasSvg: !!btn.querySelector('svg'),
        });
      }
    });
    return results;
  }, { yMin: NAV_AREA_Y_MIN, yMax: NAV_AREA_Y_MAX });

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
    // evaluate로 직접 클릭 (오버레이 우회)
    await page.evaluate(({ bx, by, bw, bh }) => {
      const doc = (globalThis as any).document;
      const el = doc.elementFromPoint(bx + bw / 2, by + bh / 2) as any;
      if (el) el.click();
    }, { bx: btn.x, by: btn.y, bw: btn.w, bh: btn.h });
    await page.waitForTimeout(CLICK_DELAY);
  }

  // 날짜 변경 확인
  await page.waitForTimeout(SETTLE_DELAY);
  const newDate = await getCurrentDate();
  logger.info('날짜 이동', { from: currentDate, to: newDate, target: targetFormatted, diff: diffDays });
}
