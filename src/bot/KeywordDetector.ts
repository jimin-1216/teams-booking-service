/**
 * 그룹 채팅 키워드 감지 — 예약 의도가 있는 메시지를 탐지
 *
 * @멘션 없이도 "회의실 잡자", "미팅룸 예약" 등의 메시지에 봇이 반응
 * Bot Framework 채널 봇으로 설치된 경우에만 동작 (RSC 권한 필요)
 */

/** 예약 의도를 나타내는 키워드 조합 */
const BOOKING_KEYWORDS = [
  '회의실', '미팅룸', '미팅 룸', '회의 룸',
] as const;

const ACTION_KEYWORDS = [
  '잡자', '잡아', '잡을까', '잡아줘', '잡아라',
  '예약', '예약하자', '예약할까', '예약해',
  '빌리자', '빌릴까', '빌려',
  '쓰자', '쓸까', '쓸 수',
  '하자', '할까', '합시다',
] as const;

/** 단독으로 예약 의도를 나타내는 패턴 */
const STANDALONE_PATTERNS = [
  /미팅\s*하자/,
  /미팅\s*할까/,
  /미팅\s*합시다/,
  /회의\s*하자/,
  /회의\s*할까/,
  /회의\s*합시다/,
  /회의실\s*(?:잡|예약|빌|쓰)/,
  /미팅룸\s*(?:잡|예약|빌|쓰)/,
  /몇\s*시에?\s*(?:미팅|회의|모이|모여)/,
  /(?:내일|오늘|모레|다음주).*(?:미팅|회의)/,
] as const;

/** 예약 의도가 아닌 것들 (false positive 방지) */
const EXCLUDE_PATTERNS = [
  /회의실\s*(?:어디|뭐|몇|누가|언제)\s*(?:야|예요|인가|였)/,  // 단순 질문
  /회의\s*(?:끝|끝나|마치)/,  // 회의 종료 관련
  /회의\s*(?:참석|참여|들어가)/,  // 회의 참석 (예약 아님)
  /회의록/,  // 회의록
] as const;

export interface DetectionResult {
  detected: boolean;
  confidence: 'high' | 'medium' | 'low';
  matchedText?: string;
}

/**
 * 메시지에서 예약 의도 키워드를 감지
 */
export function detectBookingIntent(text: string): DetectionResult {
  const normalized = text.trim().toLowerCase();

  if (!normalized || normalized.length < 3) {
    return { detected: false, confidence: 'low' };
  }

  // 제외 패턴 먼저 체크
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { detected: false, confidence: 'low' };
    }
  }

  // 단독 패턴 매칭 (높은 확신도)
  for (const pattern of STANDALONE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return { detected: true, confidence: 'high', matchedText: match[0] };
    }
  }

  // 키워드 조합 매칭 (장소 + 행동)
  const hasBookingKeyword = BOOKING_KEYWORDS.some(k => normalized.includes(k));
  const hasActionKeyword = ACTION_KEYWORDS.some(k => normalized.includes(k));

  if (hasBookingKeyword && hasActionKeyword) {
    return { detected: true, confidence: 'high', matchedText: text };
  }

  // 장소 키워드만 있고 시간 표현이 있으면 medium
  if (hasBookingKeyword) {
    const hasTimeExpr = /\d{1,2}\s*시|오전|오후|내일|오늘|모레/.test(normalized);
    if (hasTimeExpr) {
      return { detected: true, confidence: 'medium', matchedText: text };
    }
  }

  return { detected: false, confidence: 'low' };
}
