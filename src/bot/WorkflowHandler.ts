import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';

const logger = createLogger('WorkflowHandler');

export type MessageProcessor = (
  text: string,
  userId: string,
  userName: string,
) => Promise<string>;

/**
 * Power Automate 워크플로우용 Express 핸들러
 *
 * 워크플로우가 보내는 JSON:
 *   { "text": "내일 3시에 회의실 잡아줘", "userId": "...", "userName": "김지민" }
 *
 * 응답 JSON:
 *   { "reply": "..." }  ← 워크플로우가 이걸 채널에 포스트
 */
export function createWorkflowHandler(processMessage: MessageProcessor) {
  return async (req: Request, res: Response) => {
    try {
      const { text, userId, userName } = req.body;

      logger.info('워크플로우 메시지 수신', {
        userId: userId || 'unknown',
        userName: userName || 'unknown',
        text: (text || '').substring(0, 50),
      });

      if (!text || !text.trim()) {
        return res.json({ reply: '메시지를 입력해주세요.' });
      }

      // 멘션 태그 제거 ("<at>호비</at> 내일 3시" → "내일 3시")
      const cleanText = text.replace(/<at>.*?<\/at>/gi, '').trim();

      if (!cleanText) {
        return res.json({ reply: '메시지를 입력해주세요.' });
      }

      const reply = await processMessage(
        cleanText,
        userId || 'workflow-user',
        userName || 'Unknown',
      );

      return res.json({ reply });
    } catch (error) {
      logger.error('워크플로우 처리 오류', { error: (error as Error).message });
      return res.json({ reply: '처리 중 오류가 발생했습니다. 다시 시도해주세요.' });
    }
  };
}
