import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';
import { createLogger } from '../utils/logger';

const logger = createLogger('BookingRepository');

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed';

export interface Booking {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  date: string;
  startTime: string;
  endTime: string;
  memo: string | null;
  status: BookingStatus;
  externalBookingId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingWithRoom extends Booking {
  roomName: string;
  roomFloor: number;
  roomBuilding: string;
  roomCapacity: number | null;
}

export interface CreateBookingParams {
  roomId: string;
  userId: string;
  userName: string;
  date: string;
  startTime: string;
  endTime: string;
  memo?: string;
}

export class BookingRepository {
  /**
   * pending 상태로 예약 생성 (데이터 정합성: 외부 실행 전 DB에 먼저 기록)
   */
  createPending(params: CreateBookingParams): Booking {
    const db = getDatabase();
    const id = `bk_${uuidv4()}`;

    db.prepare(`
      INSERT INTO bookings (id, room_id, user_id, user_name, date, start_time, end_time, memo, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, params.roomId, params.userId, params.userName, params.date, params.startTime, params.endTime, params.memo || null);

    logger.info('예약 생성 (pending)', { bookingId: id, roomId: params.roomId });

    return this.findById(id)!;
  }

  /**
   * 외부 예약 성공 시 confirmed로 상태 변경
   */
  confirmBooking(id: string, externalBookingId: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE bookings
      SET status = 'confirmed', external_booking_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(externalBookingId, id);

    logger.info('예약 확정', { bookingId: id, externalBookingId });
  }

  /**
   * 외부 예약 실패 시 failed로 상태 변경
   */
  failBooking(id: string, errorMessage: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE bookings
      SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(errorMessage, id);

    logger.warn('예약 실패', { bookingId: id, errorMessage });
  }

  /**
   * 예약 취소
   */
  cancelBooking(id: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE bookings
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('confirmed', 'pending')
    `).run(id);

    logger.info('예약 취소', { bookingId: id });
  }

  findById(id: string): Booking | undefined {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT id, room_id as roomId, user_id as userId, user_name as userName,
               date, start_time as startTime, end_time as endTime, memo,
               status, external_booking_id as externalBookingId,
               error_message as errorMessage,
               created_at as createdAt, updated_at as updatedAt
        FROM bookings WHERE id = ?
      `)
      .get(id) as Booking | undefined;
  }

  /**
   * 사용자의 활성 예약 목록 (confirmed, pending)
   */
  findByUserId(userId: string): BookingWithRoom[] {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT b.id, b.room_id as roomId, b.user_id as userId, b.user_name as userName,
               b.date, b.start_time as startTime, b.end_time as endTime, b.memo,
               b.status, b.external_booking_id as externalBookingId,
               b.error_message as errorMessage,
               b.created_at as createdAt, b.updated_at as updatedAt,
               r.name as roomName, r.floor as roomFloor, r.building as roomBuilding, r.capacity as roomCapacity
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.user_id = ? AND b.status IN ('confirmed', 'pending')
        ORDER BY b.date, b.start_time
      `)
      .all(userId) as BookingWithRoom[];
  }

  /**
   * 특정 날짜/회의실의 예약 목록 (reconciliation 용)
   */
  findByDateAndRoom(date: string, roomId: string): Booking[] {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT id, room_id as roomId, user_id as userId, user_name as userName,
               date, start_time as startTime, end_time as endTime, memo,
               status, external_booking_id as externalBookingId,
               error_message as errorMessage,
               created_at as createdAt, updated_at as updatedAt
        FROM bookings
        WHERE date = ? AND room_id = ? AND status = 'confirmed'
        ORDER BY start_time
      `)
      .all(date, roomId) as Booking[];
  }

  /**
   * 오늘 이후의 confirmed 예약 목록 (리마인더 용)
   */
  findUpcomingConfirmed(): BookingWithRoom[] {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];
    return db
      .prepare(`
        SELECT b.id, b.room_id as roomId, b.user_id as userId, b.user_name as userName,
               b.date, b.start_time as startTime, b.end_time as endTime, b.memo,
               b.status, b.external_booking_id as externalBookingId,
               b.error_message as errorMessage,
               b.created_at as createdAt, b.updated_at as updatedAt,
               r.name as roomName, r.floor as roomFloor, r.building as roomBuilding, r.capacity as roomCapacity
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.date >= ? AND b.status = 'confirmed'
        ORDER BY b.date, b.start_time
      `)
      .all(today) as BookingWithRoom[];
  }
}

export const bookingRepository = new BookingRepository();
