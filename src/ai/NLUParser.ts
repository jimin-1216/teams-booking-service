import { callClaude } from './LLMClient';
import { buildNLUPrompt } from './prompts';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('NLUParser');

export type Intent = 'book' | 'cancel' | 'query' | 'status' | 'confirm' | 'reject' | 'none';

export interface ParsedEntities {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  duration: number | null;
  floor: number | null;
  room: string | null;
  memo: string | null;
}

export interface NLUResult {
  intent: Intent;
  entities: ParsedEntities;
  confidence: number;
}

/**
 * 자연어 메시지를 intent + entities로 파싱
 */
export async function parseMessage(text: string): Promise<NLUResult> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const systemPrompt = buildNLUPrompt(today, timeStr);

  try {
    const response = await callClaude(systemPrompt, text);
    const parsed = extractJSON(response.content);

    if (!parsed || !parsed.intent) {
      logger.warn('NLU 파싱 결과 없음', { text, raw: response.content });
      return defaultResult();
    }

    // intent 유효성 검증
    const validIntents: Intent[] = ['book', 'cancel', 'query', 'status', 'confirm', 'reject', 'none'];
    const intent: Intent = validIntents.includes(parsed.intent as Intent) ? parsed.intent as Intent : 'none';

    const entities: ParsedEntities = {
      date: parsed.entities?.date || null,
      startTime: parsed.entities?.startTime || null,
      endTime: parsed.entities?.endTime || null,
      duration: parsed.entities?.duration ? Number(parsed.entities.duration) : null,
      floor: parsed.entities?.floor ? Number(parsed.entities.floor) : null,
      room: parsed.entities?.room || null,
      memo: parsed.entities?.memo || null,
    };

    return {
      intent,
      entities,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch (error) {
    logger.error('NLU 파싱 실패', { text, error: (error as Error).message });
    return defaultResult();
  }
}

/**
 * 스마트 기본값 적용
 */
export function applyDefaults(entities: ParsedEntities): ParsedEntities {
  const result = { ...entities };
  const now = new Date();
  const currentHour = now.getHours();

  // 날짜: 없으면 오늘(업무시간 내) 또는 내일(업무시간 후)
  if (!result.date) {
    if (currentHour < 17) {
      result.date = now.toISOString().split('T')[0];
    } else {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      result.date = tomorrow.toISOString().split('T')[0];
    }
  }

  // 층: 없으면 7층 (입주 층)
  if (!result.floor) {
    result.floor = config.policy.defaultFloor;
  }

  // 종료시간: startTime이 있고 endTime이 없으면 계산
  if (result.startTime && !result.endTime) {
    const duration = result.duration || config.policy.defaultDurationMinutes;
    result.endTime = addMinutesToTime(result.startTime, duration);
  }

  return result;
}

/**
 * 필수 정보가 부족한지 확인
 * @returns 부족한 필드 목록
 */
export function getMissingFields(entities: ParsedEntities): string[] {
  const missing: string[] = [];
  if (!entities.date) missing.push('date');
  if (!entities.startTime) missing.push('startTime');
  return missing;
}

// --- helpers ---

interface NLURawResponse {
  intent: string;
  entities?: {
    date?: string;
    startTime?: string;
    endTime?: string;
    duration?: number;
    floor?: number;
    room?: string;
    memo?: string;
  };
  confidence?: number;
}

function extractJSON(text: string): NLURawResponse | null {
  // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[1]) as NLURawResponse;
  } catch {
    return null;
  }
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function defaultResult(): NLUResult {
  return {
    intent: 'none',
    entities: {
      date: null,
      startTime: null,
      endTime: null,
      duration: null,
      floor: null,
      room: null,
      memo: null,
    },
    confidence: 0,
  };
}
