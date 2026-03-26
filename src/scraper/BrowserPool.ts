import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('BrowserPool');

export class BrowserPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private taskCount = 0;

  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      // 매 N회 작업마다 브라우저 재시작
      if (this.taskCount >= config.scraper.restartAfterTasks) {
        logger.info('브라우저 재시작 (작업 횟수 초과)', { taskCount: this.taskCount });
        await this.close();
      } else {
        return this.browser;
      }
    }

    logger.info('새 브라우저 인스턴스 시작');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-translate',
        '--disable-sync',
        '--disable-background-networking',
        '--js-flags=--max-old-space-size=256',
      ],
    });
    this.taskCount = 0;
    return this.browser;
  }

  async getContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();

    if (!this.context) {
      this.context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
    }

    return this.context;
  }

  async getPage(): Promise<Page> {
    let browser = await this.getBrowser();

    // 브라우저 크래시 복구
    if (!browser.isConnected()) {
      logger.warn('브라우저 연결 끊김, 재시작');
      this.browser = null;
      browser = await this.getBrowser();
    }

    // 매 작업마다 새 컨텍스트 → 이전 세션/다이얼로그 잔여물 없이 깨끗하게 시작
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const page = await context.newPage();

    page.setDefaultTimeout(config.scraper.timeout);
    page.setDefaultNavigationTimeout(config.scraper.timeout);

    this.taskCount++;
    return page;
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.taskCount = 0;
      logger.info('브라우저 종료 완료');
    } catch (error) {
      logger.error('브라우저 종료 실패', { error: (error as Error).message });
    }
  }
}

// 싱글톤
export const browserPool = new BrowserPool();
