/**
 * 자연어 메시지 처리 — BookingBot(Bot Framework)과 WebhookHandler(Outgoing Webhook) 양쪽에서 공유
 */
import { parseMessage, applyDefaults, getMissingFields, ParsedEntities } from '../ai/NLUParser';
import { getState, setState, clearState, mergeEntities } from './ConversationManager';
import * as msg from './MessageBuilder';
import { validateBooking, getDailyUsage, ALLOWED_FLOORS } from '../rules/BookingPolicy';
import { roomScraper, SearchParams } from '../scraper/RoomScraper';
import { bookingExecutor } from '../scraper/BookingExecutor';
import { bookingRepository } from '../data/BookingRepository';
import { roomRepository } from '../data/RoomRepository';
import { isSneakyModeAvailable, splitBooking, buildSplitPreview, SplitResult } from '../rules/BookingSplitter';
import { createLogger } from '../utils/logger';
import { config } from '../config';
import { scraperQueue } from '../utils/queue';

const logger = createLogger('NLUHandler');

/**
 * 자연어 메시지를 처리하고 텍스트 응답을 반환
 */
export async function processNaturalLanguage(
  text: string,
  userId: string,
  userName: string,
): Promise<string> {
  const state = getState(userId);

  // 1. confirming 상태에서 확인/거절 처리
  if (state?.step === 'confirming') {
    return handleConfirmStep(text, userId, userName);
  }

  // 2. Claude API로 NLU 파싱
  const nlu = await parseMessage(text);
  logger.info('NLU 결과', { userId, intent: nlu.intent, confidence: nlu.confidence, entities: nlu.entities });

  // 3. intent별 분기
  switch (nlu.intent) {
    case 'book':
      return handleBookIntent(nlu.entities, userId, userName);

    case 'cancel':
      return handleCancelIntent(nlu.entities, userId);

    case 'status':
      return handleStatusIntent(userId);

    case 'query':
      return handleQueryIntent(nlu.entities, userId);

    case 'confirm':
      // confirming 상태가 아닌데 confirm이 온 경우
      if (state?.step === 'collecting') {
        // collecting 중 엔티티를 머지해서 재시도
        const merged = mergeEntities(state.entities, nlu.entities);
        return handleBookIntent(merged as ParsedEntities, userId, userName);
      }
      return '확인할 예약이 없어요. 새로 예약하려면 "내일 3시에 회의실 잡아줘"처럼 말씀해주세요.';

    case 'reject':
      if (state) {
        clearState(userId);
        return '알겠습니다. 취소했어요.';
      }
      return '취소할 내용이 없어요.';

    case 'none':
    default:
      return '무슨 말인지 잘 모르겠어요. 회의실 예약은 "내일 3시에 회의실 잡아줘"처럼 말씀해주세요.\n\n사용법: "도움말"';
  }
}

async function handleBookIntent(
  entities: ParsedEntities | Partial<ParsedEntities>,
  userId: string,
  userName: string,
): Promise<string> {
  // 기존 상태와 머지
  const state = getState(userId);
  const merged = state?.entities
    ? mergeEntities(state.entities, entities as ParsedEntities)
    : entities;

  // 스마트 기본값 적용
  const filled = applyDefaults(merged as ParsedEntities);

  // 층 제한 검사
  if (filled.floor && !ALLOWED_FLOORS.includes(filled.floor)) {
    setState(userId, { step: 'collecting', entities: { ...filled, floor: null } });
    return msg.buildFloorRestrictionMessage(filled.floor);
  }

  // 필수 필드 체크
  const missing = getMissingFields(filled);
  if (missing.length > 0) {
    setState(userId, { step: 'collecting', entities: filled });
    return msg.buildMissingFieldQuestion(missing);
  }

  // 3시간 제한 검사
  const policyCheck = validateBooking(
    userId,
    filled.date!,
    filled.startTime!,
    filled.endTime!,
    filled.floor!,
  );

  if (!policyCheck.allowed) {
    // 얍삽이 모드: 3시간 초과 시 예약 쪼개기 제안
    if (isSneakyModeAvailable()) {
      return handleSneakyMode(filled as ParsedEntities, userId, userName);
    }
    return `${policyCheck.reason}${policyCheck.suggestion ? '\n\n' + policyCheck.suggestion : ''}`;
  }

  // 공실 조회
  try {
    const params: SearchParams = {
      date: filled.date!,
      startTime: filled.startTime!,
      endTime: filled.endTime!,
      floor: filled.floor!,
    };

    // 대기열 상태 로깅
    if (scraperQueue.size > 0) {
      logger.info('스크래퍼 대기열', { queueSize: scraperQueue.size, pending: scraperQueue.pending });
    }

    const rooms = await roomScraper.searchAvailableRooms(params);

    // DB에 캐싱
    for (const room of rooms) {
      roomRepository.upsert({
        id: room.id,
        name: room.name,
        building: room.building,
        floor: room.floor,
        capacity: room.capacity,
        externalId: room.externalId,
      });
    }

    if (rooms.length === 0) {
      return msg.buildNoRoomsAvailable(filled.floor!, filled.date!, filled.startTime!, filled.endTime!);
    }

    // 첫 번째 빈 회의실 추천
    const recommended = rooms[0];
    setState(userId, {
      step: 'confirming',
      entities: filled,
      recommendation: {
        roomId: recommended.id,
        roomName: recommended.name,
        roomFloor: recommended.floor,
        roomBuilding: recommended.building,
        date: filled.date!,
        startTime: filled.startTime!,
        endTime: filled.endTime!,
      },
    });

    // 일일 사용 현황 — 기존 예약이 없어도 정책 안내 포함
    const dailyUsage = policyCheck.dailyUsage || getDailyUsage(userId, filled.date!);

    let response = msg.buildRecommendation(
      recommended.name,
      recommended.floor,
      filled.date!,
      filled.startTime!,
      filled.endTime!,
      dailyUsage,
    );

    if (rooms.length > 1) {
      response += `\n\n다른 옵션: ${rooms.slice(1, 3).map(r => r.name).join(', ')}`;
    }

    return response;
  } catch (error) {
    logger.error('공실 조회 실패', { error: (error as Error).message });
    return msg.buildError('회의실 조회 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.');
  }
}

async function handleConfirmStep(
  text: string,
  userId: string,
  userName: string,
): Promise<string> {
  const state = getState(userId)!;

  // 간단한 확인 패턴 체크 (LLM 호출 절약)
  const lower = text.trim().toLowerCase();
  const confirmPatterns = ['응', '네', 'ㅇ', 'ㅇㅇ', '좋아', '그래', '해줘', '오키', '고', '갈게', '예', 'yes', 'ok'];
  const rejectPatterns = ['아니', 'ㄴ', 'ㄴㄴ', '안할래', '됐어', '다른거', '취소', 'no'];

  const isConfirm = confirmPatterns.some(p => lower === p || lower.startsWith(p));
  const isReject = rejectPatterns.some(p => lower === p || lower.startsWith(p));

  if (isReject) {
    clearState(userId);
    return '알겠습니다. 취소했어요. 다시 예약하려면 말씀해주세요.';
  }

  if (!isConfirm) {
    // 확인/거절이 아닌 새 메시지 → 새 의도로 파싱
    clearState(userId);
    return processNaturalLanguage(text, userId, userName);
  }

  // 예약 실행
  if (!state.recommendation) {
    clearState(userId);
    return '추천된 회의실 정보가 없어요. 다시 시도해주세요.';
  }

  // 얍삽이 모드 분할 예약
  if (state.sneakySplit) {
    return executeSneakyBooking(userId, userName);
  }

  const rec = state.recommendation;
  setState(userId, { step: 'executing' });

  try {
    // DB에 pending 기록
    const booking = bookingRepository.createPending({
      roomId: rec.roomId,
      userId,
      userName,
      date: rec.date,
      startTime: rec.startTime,
      endTime: rec.endTime,
      memo: (state.entities as ParsedEntities)?.memo || undefined,
    });

    // 실제 예약 실행
    const result = await bookingExecutor.executeBooking({
      roomName: rec.roomName,
      roomBuilding: rec.roomBuilding,
      roomFloor: rec.roomFloor,
      date: rec.date,
      startTime: rec.startTime,
      endTime: rec.endTime,
      userName,
      memo: (state.entities as ParsedEntities)?.memo || undefined,
    });

    clearState(userId);

    if (result.success) {
      bookingRepository.confirmBooking(booking.id, result.externalBookingId || '');
      return msg.buildConfirmation(rec.roomName, rec.roomFloor, rec.date, rec.startTime, rec.endTime, userName);
    } else {
      bookingRepository.failBooking(booking.id, result.errorMessage || '알 수 없는 오류');
      return msg.buildError(result.errorMessage || '예약 실행 중 오류가 발생했어요.');
    }
  } catch (error) {
    clearState(userId);
    logger.error('예약 실행 실패', { error: (error as Error).message });
    return msg.buildError('예약 처리 중 문제가 발생했어요. 다시 시도해주세요.');
  }
}

async function handleCancelIntent(
  entities: ParsedEntities,
  userId: string,
): Promise<string> {
  const bookings = bookingRepository.findByUserId(userId);
  if (bookings.length === 0) {
    return '취소할 예약이 없어요.';
  }

  // 날짜가 지정되면 해당 날짜 예약 찾기
  if (entities.date) {
    const matching = bookings.filter(b => b.date === entities.date);
    if (matching.length === 0) {
      return `${entities.date}에 예약이 없어요.`;
    }
    if (matching.length === 1) {
      const b = matching[0];
      setState(userId, {
        step: 'confirming',
        entities,
        recommendation: {
          roomId: b.roomId,
          roomName: b.roomName,
          roomFloor: b.roomFloor,
          roomBuilding: b.roomBuilding,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
        },
      });
      // cancel intent의 confirm은 취소 실행으로 연결해야 하므로 별도 플래그 필요
      // 간단히: confirming 상태에서 cancel context 저장
      return msg.buildCancelConfirmQuestion(b.roomName, b.roomFloor, b.date, b.startTime, b.endTime);
    }
    // 여러 개면 리스트
    let response = '해당 날짜에 예약이 여러 개 있어요:\n';
    matching.forEach((b, i) => {
      response += `\n${i + 1}. ${b.startTime}~${b.endTime} ${b.roomFloor}층 ${b.roomName}`;
    });
    response += '\n\n어떤 예약을 취소할까요?';
    return response;
  }

  // 날짜 미지정 — 가장 가까운 예약
  if (bookings.length === 1) {
    const b = bookings[0];
    return msg.buildCancelConfirmQuestion(b.roomName, b.roomFloor, b.date, b.startTime, b.endTime);
  }

  let response = '예약이 여러 개 있어요:\n';
  bookings.slice(0, 5).forEach((b, i) => {
    response += `\n${i + 1}. ${b.date} ${b.startTime}~${b.endTime} ${b.roomFloor}층 ${b.roomName}`;
  });
  response += '\n\n어떤 예약을 취소할까요? (예: "내일 3시 예약 취소")';
  return response;
}

/**
 * 얍삽이 모드: 3시간 초과 예약을 쪼개서 팀원 이름으로 분할 제안
 */
async function handleSneakyMode(
  entities: ParsedEntities,
  userId: string,
  userName: string,
): Promise<string> {
  const split = splitBooking(userId, userName, entities.date!, entities.startTime!, entities.endTime!);

  if (split.slots.length <= 1) {
    return '쪼갤 필요가 없어요. 일반 예약으로 진행할게요.';
  }

  // 공실 조회 (전체 시간대)
  try {
    const params: SearchParams = {
      date: entities.date!,
      startTime: entities.startTime!,
      endTime: entities.endTime!,
      floor: entities.floor!,
    };

    const rooms = await roomScraper.searchAvailableRooms(params);

    if (rooms.length === 0) {
      return msg.buildNoRoomsAvailable(entities.floor!, entities.date!, entities.startTime!, entities.endTime!);
    }

    const recommended = rooms[0];

    // 상태 저장 — confirming + sneakySplit
    setState(userId, {
      step: 'confirming',
      entities,
      recommendation: {
        roomId: recommended.id,
        roomName: recommended.name,
        roomFloor: recommended.floor,
        roomBuilding: recommended.building,
        date: entities.date!,
        startTime: entities.startTime!,
        endTime: entities.endTime!,
      },
      sneakySplit: split,
    });

    // DB에 캐싱
    for (const room of rooms) {
      roomRepository.upsert({
        id: room.id, name: room.name, building: room.building,
        floor: room.floor, capacity: room.capacity, externalId: room.externalId,
      });
    }

    let response = `${recommended.floor}층 ${recommended.name}이 비어있어요.\n\n`;
    response += buildSplitPreview(split);

    return response;
  } catch (error) {
    logger.error('얍삽이 모드 공실 조회 실패', { error: (error as Error).message });
    return msg.buildError('회의실 조회 중 문제가 발생했어요.');
  }
}

/**
 * 얍삽이 모드 확인 → 분할 예약 순차 실행
 */
async function executeSneakyBooking(
  userId: string,
  userName: string,
): Promise<string> {
  const state = getState(userId)!;
  const rec = state.recommendation!;
  const split = state.sneakySplit!;

  setState(userId, { step: 'executing' });

  const results: string[] = [];
  let successCount = 0;

  for (const slot of split.slots) {
    try {
      // 본인 슬롯만 내부 DB에 기록
      if (slot.isOwner) {
        bookingRepository.createPending({
          roomId: rec.roomId,
          userId,
          userName: slot.userName,
          date: rec.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      }

      // 외부 사이트에 예약 실행
      const result = await bookingExecutor.executeBooking({
        roomName: rec.roomName,
        roomBuilding: rec.roomBuilding,
        roomFloor: rec.roomFloor,
        date: rec.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        userName: slot.userName,
        memo: slot.isOwner ? undefined : `${userName} 대리 예약`,
      });

      if (result.success) {
        if (slot.isOwner) {
          // pending → confirmed
          const bookings = bookingRepository.findByUserIdAndDate(userId, rec.date);
          const pending = bookings.find(b => b.startTime === slot.startTime && b.status === 'pending');
          if (pending) bookingRepository.confirmBooking(pending.id, result.externalBookingId || '');
        }
        successCount++;
        const marker = slot.isOwner ? '✅' : '✅🔄';
        results.push(`${marker} ${slot.startTime}~${slot.endTime} ${slot.userName}`);
      } else {
        const marker = slot.isOwner ? '❌' : '❌🔄';
        results.push(`${marker} ${slot.startTime}~${slot.endTime} ${slot.userName} — ${result.errorMessage}`);
      }
    } catch (error) {
      results.push(`❌ ${slot.startTime}~${slot.endTime} ${slot.userName} — ${(error as Error).message}`);
    }
  }

  clearState(userId);

  let response = `얍삽이 예약 완료 (${successCount}/${split.slots.length}건 성공)\n`;
  response += `📍 ${rec.roomFloor}층 ${rec.roomName}\n\n`;
  response += results.join('\n');

  return response;
}

async function handleStatusIntent(userId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const usage = getDailyUsage(userId, today);
  return msg.buildDailyUsageMessage(usage);
}

async function handleQueryIntent(
  entities: ParsedEntities,
  userId: string,
): Promise<string> {
  const filled = applyDefaults(entities);
  const missing = getMissingFields(filled);

  if (missing.includes('startTime')) {
    return '몇 시 기준으로 확인할까요? (예: 오후 3시)';
  }

  try {
    const params: SearchParams = {
      date: filled.date!,
      startTime: filled.startTime!,
      endTime: filled.endTime!,
      floor: filled.floor!,
    };

    const rooms = await roomScraper.searchAvailableRooms(params);

    if (rooms.length === 0) {
      return msg.buildNoRoomsAvailable(filled.floor!, filled.date!, filled.startTime!, filled.endTime!);
    }

    let response = `${filled.date} ${filled.startTime}~${filled.endTime} 빈 회의실:\n`;
    rooms.forEach(r => {
      response += `\n• ${r.floor}층 ${r.name}`;
    });
    response += '\n\n예약하려면 "잡아줘"라고 말씀해주세요.';
    return response;
  } catch (error) {
    return msg.buildError('조회 중 문제가 발생했어요.');
  }
}
