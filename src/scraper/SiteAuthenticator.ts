import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { createLogger } from '../utils/logger';
import { browserPool } from './BrowserPool';

const logger = createLogger('SiteAuthenticator');

// 셀렉터 외부 설정 로드
const selectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'selectors.json'), 'utf-8'),
);

export class SiteAuthenticator {
  private authenticated = false;

  async login(page: Page): Promise<void> {
    const start = Date.now();

    try {
      logger.info('센터 예약 사이트 로그인 시작');

      await page.goto(config.mile.loginUrl, { waitUntil: 'networkidle' });

      // 아이디 입력
      const usernameInput = await page.waitForSelector(selectors.login.usernameInput, {
        timeout: 10_000,
      });
      if (!usernameInput) throw new Error('아이디 입력 필드를 찾을 수 없습니다.');
      await usernameInput.fill(config.mile.username);

      // 비밀번호 입력
      const passwordInput = await page.waitForSelector(selectors.login.passwordInput, {
        timeout: 5_000,
      });
      if (!passwordInput) throw new Error('비밀번호 입력 필드를 찾을 수 없습니다.');
      await passwordInput.fill(config.mile.password);

      // 로그인 버튼 클릭
      const submitBtn = await page.waitForSelector(selectors.login.submitButton, {
        timeout: 5_000,
      });
      if (!submitBtn) throw new Error('로그인 버튼을 찾을 수 없습니다.');
      await submitBtn.click();

      // 로그인 성공 확인
      await page.waitForSelector(selectors.login.loginSuccessIndicator, {
        timeout: 10_000,
      });

      this.authenticated = true;
      logger.info('로그인 성공', { duration_ms: Date.now() - start });
    } catch (error) {
      this.authenticated = false;
      await this.captureScreenshot(page, 'login-failure');
      logger.error('로그인 실패', {
        duration_ms: Date.now() - start,
        error: (error as Error).message,
      });
      throw new Error(`센터 예약 사이트 로그인 실패: ${(error as Error).message}`);
    }
  }

  async ensureAuthenticated(page: Page): Promise<void> {
    if (!this.authenticated) {
      await this.login(page);
    }

    // 세션 만료 체크 - 로그인 페이지로 리다이렉트되었는지 확인
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      logger.info('세션 만료 감지, 재로그인');
      this.authenticated = false;
      await this.login(page);
    }
  }

  async captureScreenshot(page: Page, name: string): Promise<string> {
    try {
      const filename = `${name}_${Date.now()}.png`;
      const filepath = path.join(config.logs.screenshotDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      logger.info('스크린샷 저장', { path: filepath });
      return filepath;
    } catch (error) {
      logger.error('스크린샷 저장 실패', { error: (error as Error).message });
      return '';
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  resetAuth(): void {
    this.authenticated = false;
  }
}

export const siteAuth = new SiteAuthenticator();
