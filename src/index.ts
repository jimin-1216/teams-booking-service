import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationBotFrameworkAuthenticationOptions,
} from 'botbuilder';
import { config, validateConfig } from './config';
import { initializeDatabase, closeDatabase } from './data/database';
import { BookingBot } from './bot/BookingBot';
import { browserPool } from './scraper/BrowserPool';
import { createLogger } from './utils/logger';
import { createWebhookHandler } from './bot/WebhookHandler';
import { createWorkflowHandler } from './bot/WorkflowHandler';
import { processNaturalLanguage } from './bot/NLUHandler';

const logger = createLogger('main');

async function main() {
  // 1. 환경변수 검증
  validateConfig();
  logger.info('환경변수 검증 완료');

  // 2. 데이터베이스 초기화
  initializeDatabase();
  logger.info('데이터베이스 초기화 완료');

  // 3. Bot Framework 설정
  const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication(
    {
      MicrosoftAppId: config.bot.appId,
      MicrosoftAppPassword: config.bot.appPassword,
      MicrosoftAppTenantId: config.bot.appTenantId,
      MicrosoftAppType: config.bot.appType,
    } as ConfigurationBotFrameworkAuthenticationOptions,
  );

  const adapter = new CloudAdapter(botFrameworkAuth);

  // 에러 핸들러
  adapter.onTurnError = async (context, error) => {
    logger.error('Bot 오류 발생', { error: (error as Error).message });
    await context.sendActivity('오류가 발생했습니다. 다시 시도해주세요.');
  };

  // 4. Bot 인스턴스 생성
  const bot = new BookingBot();

  // 5. Express 서버 설정
  const app = express();
  app.use(express.json());

  // Bot Framework 메시지 엔드포인트
  app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, (context) => bot.run(context));
  });

  // Outgoing Webhook 엔드포인트 (관리자 앱 승인 없이 Teams 연결)
  const webhookHandler = createWebhookHandler(async (text, userId, userName, _convId, _isGroup) => {
    if (config.ai.apiKey) {
      return processNaturalLanguage(text, userId, userName);
    }

    // Claude API 키 없으면 기본 응답
    const lower = text.toLowerCase();
    if (lower.includes('도움말') || lower.includes('help')) {
      return '회의실 예약 봇입니다.\n\n사용법:\n• "내일 3시에 회의실 잡아줘"\n• "오늘 남은 시간"\n• "내 예약"\n• "예약 취소"';
    }
    return 'AI 기능이 아직 설정되지 않았습니다. ANTHROPIC_API_KEY를 .env에 추가해주세요.';
  });
  app.post('/api/webhook', webhookHandler);

  // Power Automate 워크플로우 엔드포인트
  const workflowHandler = createWorkflowHandler(async (text, userId, userName) => {
    if (config.ai.apiKey) {
      return processNaturalLanguage(text, userId, userName);
    }
    return 'AI 기능이 설정되지 않았습니다. OPENAI_API_KEY를 .env에 추가해주세요.';
  });
  app.post('/api/workflow', workflowHandler);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 디버그 스크린샷 목록
  app.get('/debug/screenshots', (_req, res) => {
    const dir = config.logs.screenshotDir;
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .reverse()
      .slice(0, 20);
    res.json(files.map(f => ({ name: f, url: `/debug/screenshots/${f}` })));
  });

  // 디버그 스크린샷 이미지
  app.get('/debug/screenshots/:filename', (req, res) => {
    const filepath = path.join(config.logs.screenshotDir, req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
    res.sendFile(filepath);
  });

  // 6. 서버 시작
  app.listen(config.bot.port, () => {
    logger.info(`서버 시작`, { port: config.bot.port, env: config.nodeEnv });
    logger.info('Bot 메시지 엔드포인트: /api/messages');
  });

  // 7. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} 수신, 서버 종료 중...`);
    await browserPool.close();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('서버 시작 실패', { error: (error as Error).message });
  process.exit(1);
});
