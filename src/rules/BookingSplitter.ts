import { getDailyUsage, DAILY_LIMIT_MINUTES } from './BookingPolicy';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookingSplitter');

export interface SplitSlot {
  startTime: string;
  endTime: string;
  userName: string;
  /** true = 본인 예약 (내부 DB 기록), false = 대리 예약 (점유용) */
  isOwner: boolean;
}

export interface SplitResult {
  slots: SplitSlot[];
  totalMinutes: number;
  ownerMinutes: number;
  proxyMinutes: number;
}

/**
 * 시간 문자열 → 분 ("09:30" → 570)
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 분 → 시간 문자열 (570 → "09:30")
 */
function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 얍삽이 모드 활성화 여부
 */
export function isSneakyModeAvailable(): boolean {
  return config.sneakyMode.enabled && config.sneakyMode.teamMembers.length > 0;
}

/**
 * 예약을 쪼개서 본인 + 팀원 슬롯으로 분할
 *
 * 전략:
 * 1. 본인의 남은 일일 한도만큼 본인 이름으로 예약
 * 2. 초과분은 팀원 이름을 돌아가며 배정 (각 팀원도 3시간 한도 적용)
 * 3. 시간 순서대로 연속 배치하여 빈 틈 없이 점유
 */
export function splitBooking(
  userId: string,
  ownerName: string,
  date: string,
  startTime: string,
  endTime: string,
): SplitResult {
  const totalMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  const usage = getDailyUsage(userId, date);
  const ownerRemaining = Math.max(0, DAILY_LIMIT_MINUTES - usage.totalMinutes);

  const slots: SplitSlot[] = [];
  let cursor = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  // 1. 본인 슬롯 (남은 한도만큼)
  if (ownerRemaining > 0) {
    const ownerEnd = Math.min(cursor + ownerRemaining, end);
    slots.push({
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(ownerEnd),
      userName: ownerName,
      isOwner: true,
    });
    cursor = ownerEnd;
  }

  // 2. 초과분 → 팀원 이름 순환
  const members = config.sneakyMode.teamMembers;
  let memberIdx = 0;

  while (cursor < end) {
    if (memberIdx >= members.length) {
      // 팀원 다 소진 — 처음부터 재순환
      memberIdx = 0;
    }

    const memberName = members[memberIdx];
    const slotEnd = Math.min(cursor + DAILY_LIMIT_MINUTES, end);

    slots.push({
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(slotEnd),
      userName: memberName,
      isOwner: false,
    });

    cursor = slotEnd;
    memberIdx++;
  }

  const ownerMinutes = slots
    .filter(s => s.isOwner)
    .reduce((sum, s) => sum + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)), 0);

  const result: SplitResult = {
    slots,
    totalMinutes,
    ownerMinutes,
    proxyMinutes: totalMinutes - ownerMinutes,
  };

  logger.info('예약 쪼개기 완료', {
    date,
    startTime,
    endTime,
    totalMinutes,
    ownerMinutes,
    proxyMinutes: result.proxyMinutes,
    slotCount: slots.length,
    slots: slots.map(s => `${s.startTime}-${s.endTime} (${s.userName})`),
  });

  return result;
}

/**
 * 쪼개기 미리보기 메시지 생성
 */
export function buildSplitPreview(result: SplitResult): string {
  let msg = `🔀 얍삽이 모드 — 예약 ${result.slots.length}건으로 분할\n`;
  msg += `총 ${formatMin(result.totalMinutes)} (본인 ${formatMin(result.ownerMinutes)} + 대리 ${formatMin(result.proxyMinutes)})\n`;

  for (const slot of result.slots) {
    const marker = slot.isOwner ? '👤' : '🔄';
    msg += `\n${marker} ${slot.startTime}~${slot.endTime} — ${slot.userName}`;
  }

  msg += '\n\n이대로 예약할까요?';
  return msg;
}

function formatMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
