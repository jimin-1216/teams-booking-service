import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('SiteAuthenticator');

// 셀렉터 외부 설정 로드
const selectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'selectors.json'), 'utf-8'),
);

export class SiteAuthenticator {
  private authenticated = false;

  /**
   * 로그인 → 워크스페이스 선택까지 완료
   */
  async login(page: Page): Promise<void> {
    const start = Date.now();

    try {
      logger.info('센터 예약 사이트 로그인 시작');

      await page.goto(config.mile.loginUrl, { waitUntil: 'networkidle' });
      // React SPA 렌더링 대기
      await page.waitForTimeout(2000);

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

      // 입력 후 React 상태 반영 대기 (버튼 disabled → enabled)
      await page.waitForTimeout(500);

      // 로그인 버튼 클릭 (disabled 해제될 때까지 대기)
      const submitBtn = await page.waitForSelector(
        `${selectors.login.submitButton}:not(.button-solid-disabled)`,
        { timeout: 5_000 },
      );
      if (!submitBtn) throw new Error('로그인 버튼이 활성화되지 않았습니다.');
      await submitBtn.click();

      // 로그인 성공 확인: /workspace/list로 이동하면 성공
      await page.waitForURL(`**${selectors.login.loginSuccessUrl}*`, {
        timeout: 10_000,
      });
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      logger.info('로그인 성공');

      // 워크스페이스 선택
      await this.selectWorkspace(page);

      this.authenticated = true;
      logger.info('로그인 및 워크스페이스 선택 완료', { duration_ms: Date.now() - start });
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

  /**
   * 워크스페이스 선택 (/workspace/list → /meeting/예약 현황)
   */
  private async selectWorkspace(page: Page): Promise<void> {
    const currentUrl = page.url();
    if (!currentUrl.includes('/workspace/list')) return;

    logger.info('워크스페이스 선택 중...');
    const workspaceName = config.mile.workspaceName;

    // 워크스페이스 항목 클릭
    const wsItem = await page.locator(`:has-text("${workspaceName}")`).first();
    if (!wsItem) {
      throw new Error(`워크스페이스 "${workspaceName}"를 찾을 수 없습니다.`);
    }

    await wsItem.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await page.waitForTimeout(2000);

    const afterUrl = page.url();
    logger.info('워크스페이스 진입', { url: afterUrl });
  }

  /**
   * 예약 현황 페이지로 이동
   */
  async navigateToBookingPage(page: Page): Promise<void> {
    await this.ensureAuthenticated(page);

    const currentUrl = page.url();
    if (currentUrl.includes('/meeting/')) return;

    // 예약 현황 사이드바 메뉴 클릭
    const bookingNav = await page.$(`p:has-text("예약 현황")`);
    if (bookingNav) {
      await bookingNav.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      await page.waitForTimeout(2000);
    }

    // 예약 현황 페이지 도달 확인, 실패 시 직접 이동
    if (!page.url().includes('/meeting/')) {
      logger.warn('예약 현황 페이지 미도달, 직접 이동 시도');
      await page.goto(`${config.mile.baseUrl}/meeting/schedule`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }

    // 회의실 위치 필터가 보일 때까지 대기
    await page.waitForSelector("input[placeholder='회의실 위치']", { timeout: 10_000 });
  }

  async ensureAuthenticated(page: Page): Promise<void> {
    if (!this.authenticated) {
      await this.login(page);
      return;
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
