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

  // Azure Bot Service (SingleTenant)
  bot: {
    appId: process.env.MICROSOFT_APP_ID || '',
    appPassword: process.env.MICROSOFT_APP_PASSWORD || '',
    appTenantId: process.env.MICROSOFT_APP_TENANT_ID || '',
    appType: 'SingleTenant' as const,
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

  // AI (Claude API)
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
    maxTokens: 512,
    temperature: 0,
  },

  // Outgoing Webhook
  webhook: {
    secret: process.env.TEAMS_WEBHOOK_SECRET || '',
  },

  // 예약 정책
  policy: {
    dailyLimitMinutes: 180, // 3시간
    allowedFloors: [2, 7],  // 입주층(7) + 공용(2)
    defaultFloor: 7,
    defaultDurationMinutes: 30,
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
    { key: 'MICROSOFT_APP_TENANT_ID', value: config.bot.appTenantId },
  ];

  const missing = required.filter((r) => !r.value);
  if (missing.length > 0) {
    throw new Error(
      `필수 환경변수가 설정되지 않았습니다: ${missing.map((m) => m.key).join(', ')}`,
    );
  }

  // 선택적 경고
  if (!config.ai.apiKey) {
    console.warn('⚠️  ANTHROPIC_API_KEY 미설정 — AI 자연어 예약 비활성화 (카드 UI만 사용)');
  }
  if (!config.webhook.secret) {
    console.warn('⚠️  TEAMS_WEBHOOK_SECRET 미설정 — Outgoing Webhook HMAC 검증 비활성화');
  }
}
