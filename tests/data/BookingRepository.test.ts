import { describe, it, expect, beforeEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../../src/data/database';
import { BookingRepository } from '../../src/data/BookingRepository';
import { RoomRepository } from '../../src/data/RoomRepository';

describe('BookingRepository', () => {
  let bookingRepo: BookingRepository;
  let roomRepo: RoomRepository;

  const testRoom = {
    id: 'room_본관_7_회의실①',
    name: '회의실 ①',
    building: '본관',
    floor: 7,
    capacity: 4,
    externalId: '회의실 ①_본관_7층',
  };

  beforeEach(() => {
    closeDatabase();
    initializeDatabase();
    const db = getDatabase();
    db.exec('DELETE FROM bookings');
    db.exec('DELETE FROM rooms');

    bookingRepo = new BookingRepository();
    roomRepo = new RoomRepository();
    roomRepo.upsert(testRoom);
  });

  describe('createPending', () => {
    it('pending 상태로 예약을 생성한다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });

      expect(booking.id).toMatch(/^bk_/);
      expect(booking.status).toBe('pending');
      expect(booking.roomId).toBe(testRoom.id);
      expect(booking.userName).toBe('홍길동');
      expect(booking.memo).toBeNull();
    });

    it('메모와 함께 예약을 생성한다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
        memo: '팀 주간회의',
      });

      expect(booking.memo).toBe('팀 주간회의');
    });

    it('메모 없이 생성하면 null이다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '10:00',
        endTime: '11:00',
      });

      expect(booking.memo).toBeNull();
    });
  });

  describe('confirmBooking', () => {
    it('pending → confirmed로 상태 변경한다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });

      bookingRepo.confirmBooking(booking.id, 'mile_2026-03-12_14:00_회의실①');
      const updated = bookingRepo.findById(booking.id);

      expect(updated?.status).toBe('confirmed');
      expect(updated?.externalBookingId).toBe('mile_2026-03-12_14:00_회의실①');
    });
  });

  describe('failBooking', () => {
    it('pending → failed로 상태 변경하고 에러 메시지를 저장한다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });

      bookingRepo.failBooking(booking.id, '회의실을 찾을 수 없습니다');
      const updated = bookingRepo.findById(booking.id);

      expect(updated?.status).toBe('failed');
      expect(updated?.errorMessage).toBe('회의실을 찾을 수 없습니다');
    });
  });

  describe('cancelBooking', () => {
    it('confirmed 예약을 취소한다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });
      bookingRepo.confirmBooking(booking.id, 'ext_123');
      bookingRepo.cancelBooking(booking.id);

      const updated = bookingRepo.findById(booking.id);
      expect(updated?.status).toBe('cancelled');
    });

    it('pending 예약도 취소할 수 있다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });
      bookingRepo.cancelBooking(booking.id);

      const updated = bookingRepo.findById(booking.id);
      expect(updated?.status).toBe('cancelled');
    });

    it('failed 예약은 취소되지 않는다', () => {
      const booking = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });
      bookingRepo.failBooking(booking.id, 'error');
      bookingRepo.cancelBooking(booking.id);

      const updated = bookingRepo.findById(booking.id);
      expect(updated?.status).toBe('failed');
    });
  });

  describe('findByUserId', () => {
    it('사용자의 활성 예약만 반환한다 (confirmed, pending)', () => {
      // pending
      bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '10:00',
        endTime: '11:00',
      });
      // confirmed
      const b2 = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
        memo: '고객 미팅',
      });
      bookingRepo.confirmBooking(b2.id, 'ext_1');
      // failed (제외 대상)
      const b3 = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '16:00',
        endTime: '17:00',
      });
      bookingRepo.failBooking(b3.id, 'error');

      const bookings = bookingRepo.findByUserId('user1');
      expect(bookings).toHaveLength(2);
      expect(bookings[0].roomName).toBe('회의실 ①');
      expect(bookings[0].roomFloor).toBe(7);
      // 메모 확인
      const confirmed = bookings.find(b => b.status === 'confirmed');
      expect(confirmed?.memo).toBe('고객 미팅');
    });

    it('다른 사용자의 예약은 반환하지 않는다', () => {
      bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user2',
        userName: '김철수',
        date: '2026-03-12',
        startTime: '10:00',
        endTime: '11:00',
      });

      const bookings = bookingRepo.findByUserId('user1');
      expect(bookings).toHaveLength(0);
    });
  });

  describe('findByDateAndRoom', () => {
    it('특정 날짜/회의실의 confirmed 예약을 반환한다', () => {
      const b = bookingRepo.createPending({
        roomId: testRoom.id,
        userId: 'user1',
        userName: '홍길동',
        date: '2026-03-12',
        startTime: '14:00',
        endTime: '15:00',
      });
      bookingRepo.confirmBooking(b.id, 'ext_1');

      const results = bookingRepo.findByDateAndRoom('2026-03-12', testRoom.id);
      expect(results).toHaveLength(1);
      expect(results[0].startTime).toBe('14:00');
    });
  });
});
