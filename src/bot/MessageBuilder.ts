import { DailyUsage } from '../rules/BookingPolicy';

/**
 * 자연어 응답 메시지 생성
 */

export function buildDailyUsageWarning(
  usage: DailyUsage,
  requestedMinutes: number,
): string {
  if (usage.totalMinutes === 0) return '';

  const usedStr = formatMinutesKo(usage.totalMinutes);
  const remainStr = formatMinutesKo(usage.remainingMinutes);
  const afterBooking = usage.remainingMinutes - requestedMinutes;
  const afterStr = formatMinutesKo(Math.max(0, afterBooking));

  let warning = `⚠️ 창업센터 일일 3시간 제한 현황\n`;
  warning += `• 오늘 누적: ${usedStr} / 잔여: ${remainStr}\n`;
  warning += `• 이 예약 후 잔여: ${afterStr}`;

  if (afterBooking <= 30 && afterBooking > 0) {
    warning += `\n⚡ 한도가 거의 다 찼습니다. 추가 예약이 어려울 수 있어요.`;
  }

  return warning;
}

export function buildRecommendation(
  roomName: string,
  floor: number,
  date: string,
  startTime: string,
  endTime: string,
  dailyUsage?: DailyUsage,
): string {
  const dateLabel = formatDateLabel(date);
  const requestedMinutes = diffMinutes(startTime, endTime);
  let parts: string[] = [];

  // 일일 사용 현황 경고 (기존 예약이 있을 때)
  if (dailyUsage) {
    const warning = buildDailyUsageWarning(dailyUsage, requestedMinutes);
    if (warning) parts.push(warning);
  }

  parts.push(`${dateLabel} ${startTime}~${endTime}, ${floor}층 ${roomName} 예약할까요?`);

  return parts.join('\n\n');
}

export function buildMissingFieldQuestion(missingFields: string[]): string {
  if (missingFields.includes('startTime') && missingFields.includes('date')) {
    return '언제로 잡을까요? (예: 내일 3시, 4/5 10시)';
  }
  if (missingFields.includes('startTime')) {
    return '몇 시에 잡을까요? (예: 오후 3시, 10시)';
  }
  if (missingFields.includes('date')) {
    return '어느 날로 잡을까요? (예: 오늘, 내일, 4/5)';
  }
  return '예약 정보를 알려주세요. (예: 내일 3시에 회의실 잡아줘)';
}

export function buildConfirmation(
  roomName: string,
  floor: number,
  date: string,
  startTime: string,
  endTime: string,
  userName: string,
): string {
  const dateLabel = formatDateLabel(date);
  return `예약 완료!\n\n${dateLabel} ${startTime}~${endTime}\n${floor}층 ${roomName}\n예약자: ${userName}`;
}

export function buildCancelConfirmQuestion(
  roomName: string,
  floor: number,
  date: string,
  startTime: string,
  endTime: string,
): string {
  const dateLabel = formatDateLabel(date);
  return `${dateLabel} ${startTime}~${endTime} ${floor}층 ${roomName} 예약을 취소할까요?`;
}

export function buildDailyUsageMessage(usage: DailyUsage): string {
  const h = Math.floor(usage.totalMinutes / 60);
  const m = usage.totalMinutes % 60;
  const rh = Math.floor(usage.remainingMinutes / 60);
  const rm = usage.remainingMinutes % 60;

  let msg = `오늘 사용: ${formatTime(h, m)} / 남은 시간: ${formatTime(rh, rm)} (일일 한도: 3시간)`;

  if (usage.bookings.length > 0) {
    msg += '\n\n오늘 예약:';
    for (const b of usage.bookings) {
      msg += `\n• ${b.startTime}~${b.endTime} ${b.roomFloor}층 ${b.roomName}`;
    }
  }

  return msg;
}

export function buildFloorRestrictionMessage(requestedFloor: number): string {
  return `${requestedFloor}층은 사용할 수 없어요. 우리 회사는 7층과 2층(공용)만 이용 가능합니다. 7층으로 잡을까요?`;
}

export function buildDailyLimitExceeded(usage: DailyUsage, requestedMinutes: number): string {
  const remaining = usage.remainingMinutes;
  if (remaining <= 0) {
    return `오늘 이미 3시간을 다 사용했어요. 추가 예약이 불가합니다.\n\n3시간 초과 이용이 필요하면 세미나실 대관 또는 1층 팀메이킹룸을 이용해주세요.`;
  }
  return `오늘 이미 ${formatMinutesKo(usage.totalMinutes)} 사용 중이라 ${formatMinutesKo(requestedMinutes)}은 초과돼요. (남은 시간: ${formatMinutesKo(remaining)})\n\n${formatMinutesKo(remaining)}으로 줄여서 예약할까요?`;
}

export function buildNoRoomsAvailable(floor: number, date: string, startTime: string, endTime: string): string {
  const dateLabel = formatDateLabel(date);
  return `${dateLabel} ${startTime}~${endTime}에 ${floor}층 빈 회의실이 없어요.\n\n다른 시간이나 2층을 확인해볼까요?`;
}

export function buildError(message: string): string {
  return `오류가 발생했어요: ${message}\n다시 시도해주세요.`;
}

// --- helpers ---

function formatDateLabel(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  if (dateStr === today) return '오늘';
  if (dateStr === tomorrowStr) return '내일';

  const d = new Date(dateStr + 'T00:00:00');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

function formatTime(h: number, m: number): string {
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function formatMinutesKo(minutes: number): string {
  return formatTime(Math.floor(minutes / 60), minutes % 60);
}

function diffMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
