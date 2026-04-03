import { BookingWithRoom, bookingRepository } from '../data/BookingRepository';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookingPolicy');

/** 허용 층: 7층(입주층) + 2층(공용) */
export const ALLOWED_FLOORS = [2, 7];

/** 일일 최대 사용 시간 (분) */
export const DAILY_LIMIT_MINUTES = 180; // 3시간

export interface DailyUsage {
  totalMinutes: number;
  remainingMinutes: number;
  bookings: BookingWithRoom[];
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
  dailyUsage?: DailyUsage;
}

/**
 * 시간 차이 계산 (분)
 * "09:00", "10:30" → 90
 */
function diffMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * 오늘 누적 사용시간 조회
 */
export function getDailyUsage(userId: string, date: string): DailyUsage {
  const bookings = bookingRepository.findByUserIdAndDate(userId, date);
  const totalMinutes = bookings.reduce((sum, b) => {
    return sum + diffMinutes(b.startTime, b.endTime);
  }, 0);

  return {
    totalMinutes,
    remainingMinutes: Math.max(0, DAILY_LIMIT_MINUTES - totalMinutes),
    bookings,
  };
}

/**
 * 층 제한 검증
 */
export function checkFloorAllowed(floor: number): PolicyCheckResult {
  if (ALLOWED_FLOORS.includes(floor)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${floor}층은 사용할 수 없습니다. 입주 층(7층)과 공용(2층)만 이용 가능합니다.`,
    suggestion: '7층 또는 2층 회의실로 예약할까요?',
  };
}

/**
 * 일일 3시간 제한 검증
 */
export function checkDailyLimit(
  userId: string,
  date: string,
  requestedStartTime: string,
  requestedEndTime: string,
): PolicyCheckResult {
  const usage = getDailyUsage(userId, date);
  const requestedMinutes = diffMinutes(requestedStartTime, requestedEndTime);

  if (requestedMinutes + usage.totalMinutes <= DAILY_LIMIT_MINUTES) {
    return { allowed: true, dailyUsage: usage };
  }

  const overMinutes = (requestedMinutes + usage.totalMinutes) - DAILY_LIMIT_MINUTES;
  const maxAllowed = usage.remainingMinutes;

  if (maxAllowed <= 0) {
    return {
      allowed: false,
      reason: `오늘 이미 ${formatMinutes(usage.totalMinutes)} 사용하여 추가 예약이 불가합니다. (일일 한도: 3시간)`,
      suggestion: '3시간 초과 이용이 필요하시면 세미나실 대관 또는 1층 팀메이킹룸을 이용해주세요.',
      dailyUsage: usage,
    };
  }

  return {
    allowed: false,
    reason: `오늘 이미 ${formatMinutes(usage.totalMinutes)} 사용 중이라 ${formatMinutes(requestedMinutes)}은 초과됩니다. (남은 시간: ${formatMinutes(maxAllowed)})`,
    suggestion: `${formatMinutes(maxAllowed)}으로 줄여서 예약할까요?`,
    dailyUsage: usage,
  };
}

/**
 * 전체 정책 검증 (예약 전 호출)
 */
export function validateBooking(
  userId: string,
  date: string,
  startTime: string,
  endTime: string,
  floor: number,
): PolicyCheckResult {
  // 1. 층 제한
  const floorCheck = checkFloorAllowed(floor);
  if (!floorCheck.allowed) return floorCheck;

  // 2. 일일 3시간 제한
  const limitCheck = checkDailyLimit(userId, date, startTime, endTime);
  if (!limitCheck.allowed) return limitCheck;

  return { allowed: true, dailyUsage: limitCheck.dailyUsage };
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
