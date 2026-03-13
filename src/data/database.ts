import Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('database');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(config.db.path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    logger.info('데이터베이스 연결', { path: config.db.path });
  }
  return db;
}

export function initializeDatabase(): void {
  const database = getDatabase();

  database.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      building TEXT NOT NULL DEFAULT '',
      floor INTEGER NOT NULL,
      capacity INTEGER,
      external_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      external_booking_id TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_date_room ON bookings(date, room_id, status);
  `);

  // 기존 DB에 memo 컬럼이 없으면 추가 (마이그레이션)
  try {
    database.exec(`ALTER TABLE bookings ADD COLUMN memo TEXT`);
    logger.info('bookings 테이블에 memo 컬럼 추가');
  } catch {
    // 이미 존재하면 무시
  }

  logger.info('데이터베이스 스키마 초기화 완료');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('데이터베이스 연결 종료');
  }
}
