import express from 'express';
import fs from 'fs';
import path from 'path';
import { App, ExpressAdapter } from '@microsoft/teams.apps';
import { config, validateConfig } from './config';
import { initializeDatabase, closeDatabase } from './data/database';
import { registerMessageHandlers } from './bot/TeamsMessageHandler';
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

  // 3. Express 서버 설정
  const expressApp = express();
  expressApp.use(express.json());

  // 4. Teams SDK 설정 — ExpressAdapter로 기존 Express 앱에 Teams 끼우기
  const adapter = new ExpressAdapter(expressApp);
  const teamsApp = new App({
    clientId: config.bot.appId,
    clientSecret: config.bot.appPassword,
    tenantId: config.bot.appTenantId,
    httpServerAdapter: adapter,
    activity: {
      mentions: { stripText: true },
    },
  });

  // 5. Teams 메시지 핸들러 등록
  registerMessageHandlers(teamsApp);

  // 6. 기존 엔드포인트 (Teams SDK와 독립적)

  // Outgoing Webhook 엔드포인트
  const webhookHandler = createWebhookHandler(async (text, userId, userName, _convId, _isGroup) => {
    if (config.ai.apiKey) {
      return processNaturalLanguage(text, userId, userName);
    }
    const lower = text.toLowerCase();
    if (lower.includes('도움말') || lower.includes('help')) {
      return '회의실 예약 봇입니다.\n\n사용법:\n• "내일 3시에 회의실 잡아줘"\n• "오늘 남은 시간"\n• "내 예약"\n• "예약 취소"';
    }
    return 'AI 기능이 아직 설정되지 않았습니다. OPENAI_API_KEY를 .env에 추가해주세요.';
  });
  expressApp.post('/api/webhook', webhookHandler);

  // Power Automate 워크플로우 엔드포인트
  const workflowHandler = createWorkflowHandler(async (text, userId, userName) => {
    if (config.ai.apiKey) {
      return processNaturalLanguage(text, userId, userName);
    }
    return 'AI 기능이 설정되지 않았습니다. OPENAI_API_KEY를 .env에 추가해주세요.';
  });
  expressApp.post('/api/workflow', workflowHandler);

  // Health check
  expressApp.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 디버그 스크린샷 목록
  expressApp.get('/debug/screenshots', (_req, res) => {
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
  expressApp.get('/debug/screenshots/:filename', (req, res) => {
    const filepath = path.join(config.logs.screenshotDir, req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
    res.sendFile(filepath);
  });

  // 7. 서버 시작 (Teams SDK가 Express 앱 + /api/messages 라우트를 관리)
  await teamsApp.start(config.bot.port);
  logger.info(`서버 시작`, { port: config.bot.port, env: config.nodeEnv });
  logger.info('Teams 메시지 엔드포인트: /api/messages');

  // 8. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} 수신, 서버 종료 중...`);
    await teamsApp.stop();
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
