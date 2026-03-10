import {
  ActivityHandler,
  TurnContext,
  MessageFactory,
  TeamsActivityHandler,
  CardFactory,
} from 'botbuilder';
import { createLogger } from '../utils/logger';
import { CardBuilder } from './CardBuilder';
import { roomScraper, SearchParams } from '../scraper/RoomScraper';
import { bookingExecutor } from '../scraper/BookingExecutor';
import { bookingRepository } from '../data/BookingRepository';
import { roomRepository } from '../data/RoomRepository';

const logger = createLogger('BookingBot');

// 연속 실패 카운터 (관리자 알림용)
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 3;

export class BookingBot extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context: TurnContext, next) => {
      await this.handleMessage(context);
      await next();
    });

    this.onMembersAdded(async (context: TurnContext, next) => {
      for (const member of context.activity.membersAdded || []) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            '안녕하세요! 회의실 예약 챗봇입니다. "도움말"을 입력하면 사용법을 확인할 수 있습니다.',
          );
        }
      }
      await next();
    });
  }

  private async handleMessage(context: TurnContext): Promise<void> {
    // Adaptive Card 제출 처리
    if (context.activity.value) {
      await this.handleCardAction(context);
      return;
    }

    const text = (context.activity.text || '').trim().toLowerCase();

    // 키워드 명령어 처리
    if (text.includes('예약 조회') || text.includes('조회') || text.includes('예약')) {
      await context.sendActivity({
        attachments: [CardBuilder.createSearchCard()],
      });
    } else if (text.includes('내 예약') || text.includes('목록')) {
      await this.handleMyBookings(context);
    } else if (text.includes('도움말') || text.includes('도움') || text.includes('help')) {
      await context.sendActivity({
        attachments: [CardBuilder.createHelpCard()],
      });
    } else {
      // 인식 불가 → 도움말 표시
      await context.sendActivity({
        attachments: [CardBuilder.createHelpCard()],
      });
    }
  }

  private async handleCardAction(context: TurnContext): Promise<void> {
    const data = context.activity.value;
    const action = data?.action;

    try {
      switch (action) {
        case 'showSearchForm':
          await context.sendActivity({
            attachments: [CardBuilder.createSearchCard()],
          });
          break;

        case 'searchRooms':
          await this.handleSearchRooms(context, data);
          break;

        case 'bookRoom':
          await this.handleBookRoom(context, data);
          break;

        case 'cancelBooking':
          await this.handleCancelBooking(context, data);
          break;

        default:
          logger.warn('알 수 없는 Card action', { action });
          await context.sendActivity('알 수 없는 요청입니다. "도움말"을 입력해주세요.');
      }
    } catch (error) {
      logger.error('Card action 처리 실패', { action, error: (error as Error).message });
      await this.handleScraperError(context, error as Error);
    }
  }

  /**
   * 빈 회의실 조회
   */
  private async handleSearchRooms(context: TurnContext, data: Record<string, string>): Promise<void> {
    const { date, startTime, endTime, floor } = data;

    if (!date || !startTime || !endTime) {
      await context.sendActivity('날짜와 시간을 모두 입력해주세요.');
      return;
    }

    // 입력 검증
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await context.sendActivity('날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      await context.sendActivity('시간 형식이 올바르지 않습니다. (HH:mm)');
      return;
    }
    if (startTime >= endTime) {
      await context.sendActivity('종료 시간은 시작 시간보다 뒤여야 합니다.');
      return;
    }
    if (new Date(date) < new Date(new Date().toISOString().split('T')[0])) {
      await context.sendActivity('과거 날짜는 선택할 수 없습니다.');
      return;
    }

    await context.sendActivity('회의실을 조회 중입니다... (최대 10초 소요)');

    const params: SearchParams = {
      date,
      startTime,
      endTime,
      floor: floor && floor !== 'all' ? parseInt(floor, 10) : undefined,
    };

    const rooms = await roomScraper.searchAvailableRooms(params);

    // 조회된 회의실 정보를 DB에 캐싱
    for (const room of rooms) {
      roomRepository.upsert({
        id: room.id,
        name: room.name,
        floor: room.floor,
        capacity: room.capacity,
        externalId: room.externalId,
      });
    }

    consecutiveFailures = 0; // 성공 시 리셋

    await context.sendActivity({
      attachments: [CardBuilder.createResultCard(rooms, date, startTime, endTime)],
    });
  }

  /**
   * 회의실 예약 실행
   */
  private async handleBookRoom(context: TurnContext, data: Record<string, string>): Promise<void> {
    const { roomId, roomName, roomFloor, date, startTime, endTime } = data;
    const userId = context.activity.from.id;
    const userName = context.activity.from.name || 'Unknown';

    await context.sendActivity(
      `${roomFloor}층 ${roomName} 예약 중입니다... (최대 15초 소요)`,
    );

    // 1. DB에 pending 상태로 먼저 기록
    const booking = bookingRepository.createPending({
      roomId,
      userId,
      userName,
      date,
      startTime,
      endTime,
    });

    // 2. 센터 예약 사이트에서 실제 예약 실행
    const room = roomRepository.findById(roomId);
    const result = await bookingExecutor.executeBooking({
      roomExternalId: room?.externalId || roomId,
      date,
      startTime,
      endTime,
      userName,
    });

    // 3. 결과에 따라 DB 상태 업데이트
    if (result.success) {
      bookingRepository.confirmBooking(booking.id, result.externalBookingId || '');
      consecutiveFailures = 0;

      await context.sendActivity({
        attachments: [
          CardBuilder.createBookingConfirmCard(
            booking.id,
            roomName,
            parseInt(roomFloor, 10),
            date,
            startTime,
            endTime,
            userName,
          ),
        ],
      });
    } else {
      bookingRepository.failBooking(booking.id, result.errorMessage || '알 수 없는 오류');

      await context.sendActivity({
        attachments: [
          CardBuilder.createErrorCard(
            '예약 실패',
            result.errorMessage || '예약 중 오류가 발생했습니다. 다시 시도해주세요.',
          ),
        ],
      });
    }
  }

  /**
   * 예약 취소
   */
  private async handleCancelBooking(context: TurnContext, data: Record<string, string>): Promise<void> {
    const { bookingId } = data;
    const userId = context.activity.from.id;

    const booking = bookingRepository.findById(bookingId);
    if (!booking) {
      await context.sendActivity('해당 예약을 찾을 수 없습니다.');
      return;
    }

    // 소유자 검증: 본인 예약만 취소 가능
    if (booking.userId !== userId) {
      await context.sendActivity('본인의 예약만 취소할 수 있습니다.');
      return;
    }

    await context.sendActivity('예약 취소 중입니다...');

    // 외부 사이트에서 취소 실행
    if (booking.externalBookingId) {
      const result = await bookingExecutor.cancelBooking(booking.externalBookingId);
      if (!result.success) {
        await context.sendActivity({
          attachments: [
            CardBuilder.createErrorCard(
              '취소 실패',
              result.errorMessage || '취소 중 오류가 발생했습니다.',
            ),
          ],
        });
        return;
      }
    }

    // DB 상태 업데이트
    bookingRepository.cancelBooking(bookingId);
    await context.sendActivity('예약이 취소되었습니다.');
  }

  /**
   * 내 예약 목록 조회
   */
  private async handleMyBookings(context: TurnContext): Promise<void> {
    const userId = context.activity.from.id;
    const bookings = bookingRepository.findByUserId(userId);

    await context.sendActivity({
      attachments: [CardBuilder.createMyBookingsCard(bookings)],
    });
  }

  /**
   * 스크래퍼 에러 처리 (폴백 메시지)
   */
  private async handleScraperError(context: TurnContext, error: Error): Promise<void> {
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

    // 연속 3회 실패 시 관리자 알림 (TODO: Teams 채널 알림 구현)
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
      logger.error('연속 실패 임계치 도달 - 관리자 알림 필요', {
        consecutiveFailures,
        lastError: error.message,
      });
    }

    await context.sendActivity({
      attachments: [CardBuilder.createErrorCard(title, message)],
    });
  }
}
