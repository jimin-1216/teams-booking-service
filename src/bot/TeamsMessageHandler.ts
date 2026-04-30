/**
 * Teams SDK v2 메시지 핸들러
 *
 * 기존 BookingBot(TeamsActivityHandler 상속)을 이벤트 핸들러 함수로 교체.
 * 비즈니스 로직(NLUHandler, CardBuilder 등)은 그대로 재사용.
 */
import { App, IActivityContext } from '@microsoft/teams.apps';
import { MessageActivity, Activity } from '@microsoft/teams.api';

import { createLogger } from '../utils/logger';
import { CardBuilder, CardAttachment } from './CardBuilder';
import { roomScraper, SearchParams } from '../scraper/RoomScraper';
import { bookingExecutor } from '../scraper/BookingExecutor';
import { bookingRepository } from '../data/BookingRepository';
import { roomRepository } from '../data/RoomRepository';
import { processNaturalLanguage } from './NLUHandler';
import { detectBookingIntent } from './KeywordDetector';
import { saveGroupContext, consumeGroupContext } from './ConversationManager';
import { getDailyUsage } from '../rules/BookingPolicy';
import { buildDailyUsageWarning } from './MessageBuilder';
import { config } from '../config';

const logger = createLogger('TeamsMessageHandler');

let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 3;

/** Adaptive Card attachment를 포함한 Activity 생성 */
function cardActivity(card: CardAttachment): MessageActivity {
  const activity = new MessageActivity('');
  activity.attachments = [card as any];
  return activity;
}

/**
 * Teams App에 메시지 핸들러 등록
 */
export function registerMessageHandlers(app: App): void {
  app.on('message', async (ctx) => {
    try {
      await handleMessage(ctx);
    } catch (error) {
      logger.error('메시지 처리 오류', { error: (error as Error).message });
      await ctx.reply('오류가 발생했습니다. 다시 시도해주세요.');
    }
  });

  app.on('install.add', async (ctx) => {
    await ctx.send('안녕하세요! 회의실 예약 챗봇입니다. "도움말"을 입력하면 사용법을 확인할 수 있습니다.');
  });
}

async function handleMessage(ctx: IActivityContext): Promise<void> {
  const activity = ctx.activity as Activity & {
    text?: string;
    value?: Record<string, any>;
    from: { id: string; name?: string; aadObjectId?: string };
    conversation: { id: string; conversationType?: string };
    entities?: Array<{ type: string; mentioned?: { id: string } }>;
    recipient: { id: string; name?: string };
  };

  // Adaptive Card 제출 처리
  if (activity.value && Object.keys(activity.value).length > 0) {
    await handleCardAction(ctx, activity);
    return;
  }

  const text = stripBotMention(activity);
  const lower = text.toLowerCase();
  const isGroupChat = activity.conversation.conversationType !== 'personal';

  const userId = activity.from.aadObjectId || activity.from.id;
  const userName = activity.from.name || 'Unknown';

  // 그룹 채팅: @멘션 없는 메시지는 키워드 감지만 수행
  if (isGroupChat && !isBotMentioned(activity)) {
    await handleGroupKeywordDetection(ctx, text, userId, userName, activity.conversation.id);
    return;
  }

  // 키워드 명령어 (카드 기반 fallback)
  if (lower === '예약 조회' || lower === '조회') {
    await ctx.reply(cardActivity(CardBuilder.createSearchCard()));
    return;
  }
  if (lower === '내 예약' || lower === '목록') {
    await handleMyBookings(ctx, userId);
    return;
  }
  if (lower === '도움말' || lower === '도움' || lower === 'help') {
    await ctx.reply(cardActivity(CardBuilder.createHelpCard()));
    return;
  }

  // AI 자연어 처리
  if (config.ai.apiKey) {
    try {
      let nluInput = text;
      if (isGroupChat) {
        const convId = activity.conversation.id;
        const remembered = consumeGroupContext(convId);
        if (remembered.length > 0 && isVagueCommand(text)) {
          const recentTexts = remembered.map(r => r.text);
          nluInput = recentTexts.join(' ') + ' ' + text;
          logger.info('그룹 컨텍스트 활용', { original: text, merged: nluInput });
        }
      }

      const response = await processNaturalLanguage(nluInput, userId, userName);
      await ctx.reply(response);
      return;
    } catch (error) {
      logger.error('NLU 처리 실패, 카드 UI로 fallback', { error: (error as Error).message });
    }
  }

  // Fallback: 도움말
  await ctx.reply(cardActivity(CardBuilder.createHelpCard()));
}

async function handleGroupKeywordDetection(
  ctx: IActivityContext,
  text: string,
  userId: string,
  userName: string,
  convId: string,
): Promise<void> {
  const detection = detectBookingIntent(text);
  if (!detection.detected) return;

  logger.info('그룹 채팅 키워드 감지', { text: text.substring(0, 50), confidence: detection.confidence });

  if (detection.confidence === 'medium') {
    saveGroupContext({ conversationId: convId, text, userName, userId });
    return;
  }

  // high → 즉시 반응
  if (config.ai.apiKey) {
    try {
      const response = await processNaturalLanguage(text, userId, userName);
      await ctx.reply(`${userName}님, 회의실 예약 도와드릴까요?\n\n${response}`);
      return;
    } catch (error) {
      logger.error('그룹 키워드 감지 NLU 실패', { error: (error as Error).message });
    }
  }

  await ctx.reply(
    `${userName}님, 회의실 예약이 필요하신 것 같아요! 저를 @멘션하고 "내일 3시에 회의실 잡아줘"처럼 말씀해주세요.`,
  );
}

async function handleCardAction(
  ctx: IActivityContext,
  activity: any,
): Promise<void> {
  const data = activity.value;
  const action = data?.action;
  const userId = activity.from.aadObjectId || activity.from.id;
  const userName = activity.from.name || 'Unknown';

  try {
    switch (action) {
      case 'showSearchForm':
        await ctx.reply(cardActivity(CardBuilder.createSearchCard()));
        break;

      case 'searchRooms':
        await handleSearchRooms(ctx, data);
        break;

      case 'bookRoom':
        await handleBookRoom(ctx, data, userId, userName);
        break;

      case 'cancelBooking':
        await handleCancelBooking(ctx, data, userId);
        break;

      default:
        logger.warn('알 수 없는 Card action', { action });
        await ctx.reply('알 수 없는 요청입니다. "도움말"을 입력해주세요.');
    }
  } catch (error) {
    logger.error('Card action 처리 실패', { action, error: (error as Error).message });
    await handleScraperError(ctx, error as Error);
  }
}

async function handleSearchRooms(ctx: IActivityContext, data: Record<string, string>): Promise<void> {
  const { date, startTime, endTime, floor } = data;

  if (!date || !startTime || !endTime) {
    await ctx.reply('날짜와 시간을 모두 입력해주세요.');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    await ctx.reply('날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)');
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    await ctx.reply('시간 형식이 올바르지 않습니다. (HH:mm)');
    return;
  }
  if (startTime >= endTime) {
    await ctx.reply('종료 시간은 시작 시간보다 뒤여야 합니다.');
    return;
  }
  if (new Date(date) < new Date(new Date().toISOString().split('T')[0])) {
    await ctx.reply('과거 날짜는 선택할 수 없습니다.');
    return;
  }

  await ctx.reply('회의실을 조회 중입니다... (최대 10초 소요)');

  const params: SearchParams = {
    date,
    startTime,
    endTime,
    floor: floor && floor !== 'all' ? parseInt(floor, 10) : undefined,
  };

  const rooms = await roomScraper.searchAvailableRooms(params);

  for (const room of rooms) {
    roomRepository.upsert({
      id: room.id, name: room.name, building: room.building,
      floor: room.floor, capacity: room.capacity, externalId: room.externalId,
    });
  }

  consecutiveFailures = 0;
  await ctx.reply(cardActivity(CardBuilder.createResultCard(rooms, date, startTime, endTime)));
}

async function handleBookRoom(
  ctx: IActivityContext,
  data: Record<string, string>,
  userId: string,
  userName: string,
): Promise<void> {
  const { roomId, roomName, roomFloor, date, startTime, endTime, memoFieldId } = data;
  const memo = memoFieldId ? data[memoFieldId] : (data.memo || '');

  // 예약 전 일일 사용 현황 안내
  const requestedMinutes = diffMinutes(startTime, endTime);
  const usage = getDailyUsage(userId, date);
  const usageWarning = buildDailyUsageWarning(usage, requestedMinutes);
  if (usageWarning) {
    await ctx.reply(usageWarning);
  }

  await ctx.reply(`${roomFloor}층 ${roomName} 예약 중입니다... (최대 15초 소요)`);

  if (!roomRepository.findById(roomId)) {
    roomRepository.upsert({
      id: roomId, name: roomName, building: data.roomBuilding || '',
      floor: parseInt(roomFloor, 10) || 0, capacity: null,
      externalId: `${roomName}_${data.roomBuilding || ''}_${roomFloor}층`,
    });
  }

  const booking = bookingRepository.createPending({
    roomId, userId, userName, date, startTime, endTime, memo: memo || undefined,
  });

  const room = roomRepository.findById(roomId);
  const result = await bookingExecutor.executeBooking({
    roomName: roomName || room?.name || '',
    roomBuilding: data.roomBuilding || room?.building || '',
    roomFloor: parseInt(roomFloor, 10) || room?.floor || 0,
    date, startTime, endTime, userName, memo: memo || undefined,
  });

  if (result.success) {
    bookingRepository.confirmBooking(booking.id, result.externalBookingId || '');
    consecutiveFailures = 0;
    await ctx.reply(cardActivity(
      CardBuilder.createBookingConfirmCard(booking.id, roomName, parseInt(roomFloor, 10), date, startTime, endTime, userName, memo || undefined),
    ));
  } else {
    bookingRepository.failBooking(booking.id, result.errorMessage || '알 수 없는 오류');
    await ctx.reply(cardActivity(
      CardBuilder.createErrorCard('예약 실패', result.errorMessage || '예약 중 오류가 발생했습니다. 다시 시도해주세요.'),
    ));
  }
}

async function handleCancelBooking(
  ctx: IActivityContext,
  data: Record<string, string>,
  userId: string,
): Promise<void> {
  const { bookingId } = data;
  const booking = bookingRepository.findById(bookingId);
  if (!booking) {
    await ctx.reply('해당 예약을 찾을 수 없습니다.');
    return;
  }
  if (booking.userId !== userId) {
    await ctx.reply('본인의 예약만 취소할 수 있습니다.');
    return;
  }

  await ctx.reply('예약 취소 중입니다...');

  if (booking.externalBookingId) {
    const room = roomRepository.findById(booking.roomId);
    const result = await bookingExecutor.cancelBooking(
      booking.externalBookingId, room?.name || '', booking.date, booking.startTime,
    );
    if (!result.success) {
      await ctx.reply(cardActivity(
        CardBuilder.createErrorCard('취소 실패', result.errorMessage || '취소 중 오류가 발생했습니다.'),
      ));
      return;
    }
  }

  bookingRepository.cancelBooking(bookingId);
  await ctx.reply('예약이 취소되었습니다.');
}

async function handleMyBookings(ctx: IActivityContext, userId: string): Promise<void> {
  const bookings = bookingRepository.findByUserId(userId);
  await ctx.reply(cardActivity(CardBuilder.createMyBookingsCard(bookings)));
}

async function handleScraperError(ctx: IActivityContext, error: Error): Promise<void> {
  consecutiveFailures++;

  let title = '오류 발생';
  let message = error.message;

  if (error.message.includes('큐') || error.message.includes('잠시 후')) {
    title = '요청이 많습니다';
    message = '현재 요청이 많습니다. 잠시 후 다시 시도해주세요.';
  } else if (error.message.includes('로그인')) {
    title = '인증 오류';
    message = '예약 시스템 인증에 문제가 있습니다. 관리자에게 문의해주세요.';
  } else if (error.message.includes('타임아웃') || error.message.includes('timeout')) {
    title = '응답 시간 초과';
    message = '요청 처리 시간이 초과되었습니다. 다시 시도해주세요.';
  }

  if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
    logger.error('연속 실패 임계치 도달 - 관리자 알림 필요', {
      consecutiveFailures, lastError: error.message,
    });
  }

  await ctx.reply(cardActivity(CardBuilder.createErrorCard(title, message)));
}

// --- helpers ---

function stripBotMention(activity: any): string {
  let text = (activity.text || '').trim();
  const botName = activity.recipient?.name;
  if (botName) {
    text = text.replace(new RegExp(`<at>${botName}</at>`, 'gi'), '').trim();
  }
  return text;
}

function isBotMentioned(activity: any): boolean {
  const botId = activity.recipient?.id;
  const mentions = activity.entities?.filter((e: any) => e.type === 'mention') || [];
  return mentions.some((m: any) => m.mentioned?.id === botId);
}

function isVagueCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  const vaguePatterns = [
    /^(잡아줘|해줘|부탁|예약해|예약 해|잡아|해 줘|ㄱㄱ|고고|ㅇㅋ)$/,
    /^회의실\s*(잡아|예약|부탁)/,
  ];
  if (vaguePatterns.some(p => p.test(lower))) return true;
  return lower.length <= 10 && !/\d{1,2}\s*시|오전|오후/.test(lower);
}

function diffMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
