import { getDatabase } from './database';
import { createLogger } from '../utils/logger';

const logger = createLogger('RoomRepository');

export interface Room {
  id: string;
  name: string;
  floor: number;
  capacity: number | null;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}

export class RoomRepository {
  findAll(): Room[] {
    const db = getDatabase();
    return db
      .prepare('SELECT id, name, floor, capacity, external_id as externalId, created_at as createdAt, updated_at as updatedAt FROM rooms ORDER BY floor, name')
      .all() as Room[];
  }

  findByFloor(floor: number): Room[] {
    const db = getDatabase();
    return db
      .prepare('SELECT id, name, floor, capacity, external_id as externalId, created_at as createdAt, updated_at as updatedAt FROM rooms WHERE floor = ? ORDER BY name')
      .all(floor) as Room[];
  }

  findById(id: string): Room | undefined {
    const db = getDatabase();
    return db
      .prepare('SELECT id, name, floor, capacity, external_id as externalId, created_at as createdAt, updated_at as updatedAt FROM rooms WHERE id = ?')
      .get(id) as Room | undefined;
  }

  findByExternalId(externalId: string): Room | undefined {
    const db = getDatabase();
    return db
      .prepare('SELECT id, name, floor, capacity, external_id as externalId, created_at as createdAt, updated_at as updatedAt FROM rooms WHERE external_id = ?')
      .get(externalId) as Room | undefined;
  }

  upsert(room: Omit<Room, 'createdAt' | 'updatedAt'>): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO rooms (id, name, floor, capacity, external_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        floor = excluded.floor,
        capacity = excluded.capacity,
        external_id = excluded.external_id,
        updated_at = CURRENT_TIMESTAMP
    `).run(room.id, room.name, room.floor, room.capacity, room.externalId);
  }

  bulkUpsert(rooms: Omit<Room, 'createdAt' | 'updatedAt'>[]): void {
    const db = getDatabase();
    const upsertStmt = db.prepare(`
      INSERT INTO rooms (id, name, floor, capacity, external_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        floor = excluded.floor,
        capacity = excluded.capacity,
        external_id = excluded.external_id,
        updated_at = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction((items: typeof rooms) => {
      for (const room of items) {
        upsertStmt.run(room.id, room.name, room.floor, room.capacity, room.externalId);
      }
    });

    transaction(rooms);
    logger.info('회의실 정보 일괄 갱신', { count: rooms.length });
  }
}

export const roomRepository = new RoomRepository();
