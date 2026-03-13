import { describe, it, expect, beforeEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../../src/data/database';

describe('database', () => {
  beforeEach(() => {
    closeDatabase();
  });

  it('인메모리 DB를 생성하고 스키마를 초기화한다', () => {
    initializeDatabase();
    const db = getDatabase();

    // rooms 테이블 존재 확인
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rooms', 'bookings')")
      .all() as Array<{ name: string }>;

    expect(tables.map(t => t.name).sort()).toEqual(['bookings', 'rooms']);
  });

  it('bookings 테이블에 memo 컬럼이 존재한다', () => {
    initializeDatabase();
    const db = getDatabase();

    const columns = db.prepare("PRAGMA table_info(bookings)").all() as Array<{ name: string }>;
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('memo');
  });

  it('initializeDatabase를 두 번 호출해도 에러가 없다 (마이그레이션 중복 방지)', () => {
    initializeDatabase();
    expect(() => initializeDatabase()).not.toThrow();
  });
});
