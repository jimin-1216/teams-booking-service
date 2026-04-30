import { ParsedEntities } from '../ai/NLUParser';
import { SplitResult } from '../rules/BookingSplitter';
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
  /** 얍삽이 모드 분할 정보 */
  sneakySplit?: SplitResult;
  lastActivity: number;
}

/** 그룹 채팅에서 엿들은 컨텍스트 (medium 확신도 키워드 감지) */
export interface GroupContext {
  conversationId: string;
  text: string;
  userName: string;
  userId: string;
  timestamp: number;
}

/** TTL: 5분 */
const TTL_MS = 5 * 60 * 1000;

/** 1:1 대화 상태 저장소 */
const states = new Map<string, ConversationState>();

/** 그룹 채팅 컨텍스트 저장소 (conversationId → 최근 메시지들) */
const groupContexts = new Map<string, GroupContext[]>();

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

/**
 * 그룹 채팅 컨텍스트 저장 (키워드 감지 medium → 기억만)
 */
export function saveGroupContext(ctx: Omit<GroupContext, 'timestamp'>): void {
  const convId = ctx.conversationId;
  const entries = groupContexts.get(convId) || [];

  entries.push({ ...ctx, timestamp: Date.now() });

  // 최근 5개만 유지
  if (entries.length > 5) entries.shift();

  groupContexts.set(convId, entries);
  logger.info('그룹 컨텍스트 저장', { conversationId: convId, text: ctx.text.substring(0, 30) });
}

/**
 * 그룹 채팅 컨텍스트 조회 (TTL 이내 메시지만)
 */
export function getGroupContext(conversationId: string): GroupContext[] {
  const entries = groupContexts.get(conversationId);
  if (!entries) return [];

  const now = Date.now();
  const valid = entries.filter(e => now - e.timestamp <= TTL_MS);

  if (valid.length !== entries.length) {
    if (valid.length === 0) {
      groupContexts.delete(conversationId);
    } else {
      groupContexts.set(conversationId, valid);
    }
  }

  return valid;
}

/**
 * 그룹 컨텍스트 소비 (사용 후 삭제)
 */
export function consumeGroupContext(conversationId: string): GroupContext[] {
  const ctx = getGroupContext(conversationId);
  groupContexts.delete(conversationId);
  return ctx;
}
