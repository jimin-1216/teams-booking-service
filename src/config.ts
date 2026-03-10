import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  // 센터 예약 사이트 (https://app.mile.im)
  mile: {
    username: process.env.MILE_USERNAME || '',
    password: process.env.MILE_PASSWORD || '',
    loginUrl: 'https://app.mile.im/login',
    baseUrl: 'https://app.mile.im',
    workspaceName: process.env.MILE_WORKSPACE || '서울창업허브',
  },

  // Azure Bot Service
  bot: {
    appId: process.env.MICROSOFT_APP_ID || '',
    appPassword: process.env.MICROSOFT_APP_PASSWORD || '',
    port: parseInt(process.env.PORT || '3978', 10),
  },

  // App
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Scraper
  scraper: {
    timeout: 30_000, // 30초
    maxBrowserInstances: 1,
    maxQueueSize: 5,
    queueTimeout: 60_000, // 60초
    restartAfterTasks: 10,
    maxMemoryMB: 500,
  },

  // Database
  db: {
    path: path.resolve(process.env.DB_PATH || './data/booking.db'),
  },

  // Logging
  logs: {
    screenshotDir: path.resolve('./logs/screenshots'),
  },
} as const;

// 필수 환경변수 검증
export function validateConfig(): void {
  const required: { key: string; value: string }[] = [
    { key: 'MILE_USERNAME', value: config.mile.username },
    { key: 'MILE_PASSWORD', value: config.mile.password },
    { key: 'MICROSOFT_APP_ID', value: config.bot.appId },
    { key: 'MICROSOFT_APP_PASSWORD', value: config.bot.appPassword },
  ];

  const missing = required.filter((r) => !r.value);
  if (missing.length > 0) {
    throw new Error(
      `필수 환경변수가 설정되지 않았습니다: ${missing.map((m) => m.key).join(', ')}`,
    );
  }
}
