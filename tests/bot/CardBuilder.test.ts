import { describe, it, expect } from 'vitest';
import { CardBuilder } from '../../src/bot/CardBuilder';
import { RoomInfo } from '../../src/scraper/RoomScraper';
import { BookingWithRoom } from '../../src/data/BookingRepository';

describe('CardBuilder', () => {
  describe('createSearchCard', () => {
    it('검색 폼 카드를 생성한다', () => {
      const card = CardBuilder.createSearchCard();
      expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
      expect(card.content).toBeDefined();
    });
  });

  describe('createResultCard', () => {
    const rooms: RoomInfo[] = [
      { id: 'r1', name: '회의실 ①', building: '본관', floor: 7, capacity: 4, externalId: 'ext1', available: true },
      { id: 'r2', name: '회의실 ②', building: '본관', floor: 7, capacity: 6, externalId: 'ext2', available: true },
      { id: 'r3', name: '회의실 ①', building: '본관', floor: 2, capacity: 8, externalId: 'ext3', available: true },
    ];

    it('빈 회의실 목록 카드를 생성한다', () => {
      const card = CardBuilder.createResultCard(rooms, '2026-03-12', '14:00', '15:00');
      const body = card.content.body;

      // 날짜/시간 헤더
      expect(body[0].text).toContain('2026-03-12');
      expect(body[0].text).toContain('14:00-15:00');
      // 개수
      expect(body[1].text).toContain('3개');
    });

    it('층별로 그룹핑하고 오름차순 정렬한다', () => {
      const card = CardBuilder.createResultCard(rooms, '2026-03-12', '14:00', '15:00');
      const body = card.content.body;
      const floorHeaders = body.filter((b: any) => b.type === 'TextBlock' && b.weight === 'Bolder' && /\d층/.test(b.text));

      expect(floorHeaders[0].text).toBe('2층');
      expect(floorHeaders[1].text).toBe('7층');
    });

    it('각 회의실에 Action.ShowCard (메모 입력)가 있다', () => {
      const card = CardBuilder.createResultCard(rooms, '2026-03-12', '14:00', '15:00');
      const body = card.content.body;
      const columnSets = body.filter((b: any) => b.type === 'ColumnSet');

      // 3개 회의실 → 3개 ColumnSet
      expect(columnSets).toHaveLength(3);

      // 첫 번째 회의실의 액션 확인
      const actionCol = columnSets[0].columns[1];
      const action = actionCol.items[0].actions[0];
      expect(action.type).toBe('Action.ShowCard');
      expect(action.title).toBe('예약');
      // ShowCard 내부에 Input.Text가 있어야 함
      expect(action.card.body[0].type).toBe('Input.Text');
      expect(action.card.body[0].label).toContain('사유');
      // 확정 버튼
      expect(action.card.actions[0].data.action).toBe('bookRoom');
      expect(action.card.actions[0].data.roomId).toBe('r3'); // 2층이 먼저
    });

    it('빈 회의실이 없으면 안내 메시지를 표시한다', () => {
      const card = CardBuilder.createResultCard([], '2026-03-12', '14:00', '15:00');
      const body = card.content.body;

      expect(body.some((b: any) => b.text?.includes('사용 가능한 회의실이 없습니다'))).toBe(true);
    });
  });

  describe('createBookingConfirmCard', () => {
    it('예약 확인 카드를 생성한다', () => {
      const card = CardBuilder.createBookingConfirmCard(
        'bk_123', '회의실 ①', 7, '2026-03-12', '14:00', '15:00', '홍길동',
      );
      const facts = card.content.body[1].facts;

      expect(facts.find((f: any) => f.title === '장소').value).toBe('7층 회의실 ①');
      expect(facts.find((f: any) => f.title === '예약자').value).toBe('홍길동');
    });

    it('메모가 있으면 사유 팩트를 포함한다', () => {
      const card = CardBuilder.createBookingConfirmCard(
        'bk_123', '회의실 ①', 7, '2026-03-12', '14:00', '15:00', '홍길동', '팀 주간회의',
      );
      const facts = card.content.body[1].facts;

      expect(facts.find((f: any) => f.title === '사유').value).toBe('팀 주간회의');
    });

    it('메모가 없으면 사유 팩트가 없다', () => {
      const card = CardBuilder.createBookingConfirmCard(
        'bk_123', '회의실 ①', 7, '2026-03-12', '14:00', '15:00', '홍길동',
      );
      const facts = card.content.body[1].facts;

      expect(facts.find((f: any) => f.title === '사유')).toBeUndefined();
    });

    it('취소 버튼이 있다', () => {
      const card = CardBuilder.createBookingConfirmCard(
        'bk_123', '회의실 ①', 7, '2026-03-12', '14:00', '15:00', '홍길동',
      );
      const actions = card.content.actions;

      expect(actions[0].title).toBe('취소하기');
      expect(actions[0].data.action).toBe('cancelBooking');
      expect(actions[0].data.bookingId).toBe('bk_123');
    });
  });

  describe('createMyBookingsCard', () => {
    it('예약이 없으면 안내 메시지를 표시한다', () => {
      const card = CardBuilder.createMyBookingsCard([]);
      const body = card.content.body;

      expect(body.some((b: any) => b.text?.includes('예약된 회의실이 없습니다'))).toBe(true);
    });

    it('예약 목록을 표시한다', () => {
      const bookings: BookingWithRoom[] = [
        {
          id: 'bk_1', roomId: 'r1', userId: 'u1', userName: '홍길동',
          date: '2026-03-12', startTime: '14:00', endTime: '15:00',
          memo: '고객 미팅',
          status: 'confirmed', externalBookingId: 'ext_1', errorMessage: null,
          createdAt: '', updatedAt: '',
          roomName: '회의실 ①', roomFloor: 7, roomBuilding: '본관', roomCapacity: 4,
        },
      ];

      const card = CardBuilder.createMyBookingsCard(bookings);
      const body = card.content.body;

      // 총 건수
      expect(body[1].text).toContain('1건');
      // 컨테이너 내 예약 정보
      const container = body[2];
      expect(container.type).toBe('Container');
      const items = container.items[0].columns[0].items;
      expect(items[0].text).toContain('[확정]');
      expect(items[0].text).toContain('회의실 ①');
      // 메모 표시
      expect(items[2].text).toContain('고객 미팅');
    });
  });

  describe('createErrorCard', () => {
    it('에러 카드를 생성한다', () => {
      const card = CardBuilder.createErrorCard('예약 실패', '시간이 겹칩니다');
      const body = card.content.body;

      expect(body[0].text).toBe('예약 실패');
      expect(body[1].text).toBe('시간이 겹칩니다');
    });
  });

  describe('createHelpCard', () => {
    it('도움말 카드에 조회하기 버튼이 있다', () => {
      const card = CardBuilder.createHelpCard();

      expect(card.content.actions[0].data.action).toBe('showSearchForm');
    });
  });
});
