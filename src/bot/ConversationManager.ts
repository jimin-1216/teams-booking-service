import { ParsedEntities } from '../ai/NLUParser';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConversationManager');

export type ConversationStep = 'idle' | 'collecting' | 'confirming' | 'executing';

export interface ConversationState {
  userId: string;
  step: ConversationStep;
  entities: Partial<ParsedEntities>;
  /** 추천된 회의실 정보 */
  recommendation?: {
    roomId: string;
    roomName: string;
    roomFloor: number;
    roomBuilding: string;
    date: string;
    startTime: string;
    endTime: string;
  };
  lastActivity: number;
}

/** TTL: 5분 */
const TTL_MS = 5 * 60 * 1000;

/** 대화 상태 저장소 (in-memory) */
const states = new Map<string, ConversationState>();

/**
 * 대화 상태 조회 (TTL 초과 시 자동 삭제)
 */
export function getState(userId: string): ConversationState | undefined {
  const state = states.get(userId);
  if (!state) return undefined;

  if (Date.now() - state.lastActivity > TTL_MS) {
    states.delete(userId);
    logger.info('대화 상태 만료', { userId });
    return undefined;
  }

  return state;
}

/**
 * 대화 상태 생성/갱신
 */
export function setState(userId: string, update: Partial<ConversationState>): ConversationState {
  const existing = getState(userId);
  const state: ConversationState = {
    userId,
    step: 'idle',
    entities: {},
    ...existing,
    ...update,
    lastActivity: Date.now(),
  };
  states.set(userId, state);
  return state;
}

/**
 * 대화 상태 삭제 (예약 완료/취소/타임아웃 후)
 */
export function clearState(userId: string): void {
  states.delete(userId);
}

/**
 * 기존 엔티티에 새 엔티티 머지 (null이 아닌 값만 덮어씀)
 */
export function mergeEntities(
  existing: Partial<ParsedEntities>,
  incoming: ParsedEntities,
): Partial<ParsedEntities> {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}
