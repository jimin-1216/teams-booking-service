import express from 'express';
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

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
