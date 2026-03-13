import { describe, it, expect, beforeEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../../src/data/database';
import { RoomRepository } from '../../src/data/RoomRepository';

describe('RoomRepository', () => {
  let repo: RoomRepository;

  beforeEach(() => {
    closeDatabase();
    initializeDatabase();
    const db = getDatabase();
    db.exec('DELETE FROM rooms');
    db.exec('DELETE FROM bookings');
    repo = new RoomRepository();
  });

  const room7_1 = {
    id: 'room_본관_7_회의실①',
    name: '회의실 ①',
    building: '본관',
    floor: 7,
    capacity: 4,
    externalId: '회의실 ①_본관_7층',
  };

  const room7_2 = {
    id: 'room_본관_7_회의실②',
    name: '회의실 ②',
    building: '본관',
    floor: 7,
    capacity: 6,
    externalId: '회의실 ②_본관_7층',
  };

  const room2_1 = {
    id: 'room_본관_2_회의실①',
    name: '회의실 ①',
    building: '본관',
    floor: 2,
    capacity: 8,
    externalId: '회의실 ①_본관_2층',
  };

  describe('upsert', () => {
    it('회의실을 삽입한다', () => {
      repo.upsert(room7_1);
      const found = repo.findById(room7_1.id);

      expect(found).toBeDefined();
      expect(found?.name).toBe('회의실 ①');
      expect(found?.building).toBe('본관');
      expect(found?.floor).toBe(7);
      expect(found?.capacity).toBe(4);
    });

    it('동일 ID로 upsert하면 업데이트한다', () => {
      repo.upsert(room7_1);
      repo.upsert({ ...room7_1, capacity: 6 });

      const found = repo.findById(room7_1.id);
      expect(found?.capacity).toBe(6);
    });
  });

  describe('findByFloor', () => {
    it('특정 층의 회의실만 반환한다', () => {
      repo.upsert(room7_1);
      repo.upsert(room7_2);
      repo.upsert(room2_1);

      const floor7 = repo.findByFloor(7);
      expect(floor7).toHaveLength(2);
      expect(floor7.every(r => r.floor === 7)).toBe(true);

      const floor2 = repo.findByFloor(2);
      expect(floor2).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('전체 회의실을 층/이름 순으로 반환한다', () => {
      repo.upsert(room7_2);
      repo.upsert(room2_1);
      repo.upsert(room7_1);

      const all = repo.findAll();
      expect(all).toHaveLength(3);
      // 2층이 먼저
      expect(all[0].floor).toBe(2);
      // 7층 ① < ②
      expect(all[1].name).toBe('회의실 ①');
      expect(all[2].name).toBe('회의실 ②');
    });
  });

  describe('findByExternalId', () => {
    it('externalId로 회의실을 찾는다', () => {
      repo.upsert(room7_1);

      const found = repo.findByExternalId('회의실 ①_본관_7층');
      expect(found?.id).toBe(room7_1.id);
    });

    it('없는 externalId는 undefined를 반환한다', () => {
      const found = repo.findByExternalId('nonexistent');
      expect(found).toBeUndefined();
    });
  });
});
