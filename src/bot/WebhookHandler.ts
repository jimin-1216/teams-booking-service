import crypto from 'crypto';
import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { config } from '../config';

const logger = createLogger('WebhookHandler');

export interface WebhookMessage {
  type: string;
  id: string;
  timestamp: string;
  serviceUrl: string;
  channelId: string;
  from: {
    id: string;
    name: string;
    aadObjectId?: string;
  };
  conversation: {
    id: string;
    name?: string;
    isGroup?: boolean;
  };
  text: string;
  entities?: Array<{
    type: string;
    mentioned?: { id: string; name: string };
    text?: string;
  }>;
}

/**
 * Teams Outgoing Webhook HMAC-SHA256 검증
 */
function verifyHMAC(req: Request): boolean {
  const secret = config.webhook.secret;
  if (!secret) {
    logger.warn('Webhook secret이 설정되지 않았습니다. 검증을 건너뜁니다.');
    return true;
  }

  const authHeader = req.headers['authorization'] || '';
  const providedHmac = authHeader.replace('HMAC ', '');

  if (!providedHmac) {
    logger.warn('Authorization 헤더 없음');
    return false;
  }

  const bufSecret = Buffer.from(secret, 'base64');
  const body = JSON.stringify(req.body);
  const computedHmac = crypto
    .createHmac('sha256', bufSecret)
    .update(body, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(providedHmac),
    Buffer.from(computedHmac),
  );
}

/**
 * @멘션 텍스트 제거하여 순수 메시지만 추출
 * Teams Outgoing Webhook: "<at>봇이름</at> 내일 3시에 예약해줘" → "내일 3시에 예약해줘"
 */
function stripMention(text: string): string {
  return text
    .replace(/<at>.*?<\/at>/gi, '')
    .trim();
}

export type MessageProcessor = (
  text: string,
  userId: string,
  userName: string,
  conversationId: string,
  isGroup: boolean,
) => Promise<string>;

/**
 * Outgoing Webhook Express 핸들러를 생성
 */
export function createWebhookHandler(processMessage: MessageProcessor) {
  return async (req: Request, res: Response) => {
    try {
      // 1. HMAC 검증
      if (!verifyHMAC(req)) {
        logger.warn('Webhook HMAC 검증 실패');
        return res.status(401).json({ type: 'message', text: 'Unauthorized' });
      }

      const body = req.body as WebhookMessage;

      // 2. 메시지 텍스트 추출 (멘션 제거)
      const text = stripMention(body.text || '');
      const userId = body.from?.aadObjectId || body.from?.id || 'unknown';
      const userName = body.from?.name || 'Unknown';
      const conversationId = body.conversation?.id || '';
      const isGroup = body.conversation?.isGroup ?? true;

      logger.info('Webhook 메시지 수신', {
        userId,
        userName,
        text: text.substring(0, 50),
        isGroup,
      });

      if (!text) {
        return res.json({ type: 'message', text: '메시지를 입력해주세요.' });
      }

      // 3. 메시지 처리 (NLU → 예약 로직)
      const response = await processMessage(text, userId, userName, conversationId, isGroup);

      // 4. 응답
      return res.json({ type: 'message', text: response });
    } catch (error) {
      logger.error('Webhook 처리 오류', { error: (error as Error).message });
      return res.json({
        type: 'message',
        text: '처리 중 오류가 발생했습니다. 다시 시도해주세요.',
      });
    }
  };
}
