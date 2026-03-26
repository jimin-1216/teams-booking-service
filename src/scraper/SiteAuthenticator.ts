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

      await page.waitForTimeout(500);

      // 로그인 버튼 클릭 (evaluate로 오버레이 우회)
      const loginClicked = await page.evaluate((sel) => {
        const doc = (globalThis as any).document;
        const btns = Array.from(doc.querySelectorAll(sel)) as any[];
        const activeBtn = btns.find((b: any) => !b.classList.contains('button-solid-disabled'));
        if (activeBtn) { activeBtn.click(); return true; }
        return false;
      }, selectors.login.submitButton);
      if (!loginClicked) throw new Error('로그인 버튼이 활성화되지 않았습니다.');

      // 로그인 성공 확인
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
   * 워크스페이스 선택 (evaluate로 직접 DOM 클릭)
   */
  private async selectWorkspace(page: Page): Promise<void> {
    const currentUrl = page.url();
    if (!currentUrl.includes('/workspace/list')) return;

    logger.info('워크스페이스 선택 중...');
    const workspaceName = config.mile.workspaceName;

    await page.waitForTimeout(1000);

    const wsClicked = await page.evaluate((name: string) => {
      const doc = (globalThis as any).document;
      const allEls = Array.from(doc.querySelectorAll('div, span, p, a, li')) as any[];
      for (const el of allEls) {
        if (el.textContent?.includes(name) && el.textContent.length < 100) {
          el.click();
          return true;
        }
      }
      return false;
    }, workspaceName);

    if (!wsClicked) {
      throw new Error(`워크스페이스 "${workspaceName}"를 찾을 수 없습니다.`);
    }

    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await page.waitForTimeout(2000);

    logger.info('워크스페이스 진입', { url: page.url() });
  }

  /**
   * 예약 현황 페이지로 이동
   */
  async navigateToBookingPage(page: Page): Promise<void> {
    await this.ensureAuthenticated(page);

    const currentUrl = page.url();
    if (currentUrl.includes('/meeting/')) return;

    // 다이얼로그/오버레이 먼저 닫기
    await this.dismissOverlays(page);

    // 예약 현황 사이드바 메뉴 클릭 (evaluate로 오버레이 우회)
    const navClicked = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const els = Array.from(doc.querySelectorAll('p, span, a')) as any[];
      for (const el of els) {
        if (el.textContent?.trim() === '예약 현황') {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (navClicked) {
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      await page.waitForTimeout(2000);
    }

    // 예약 현황 페이지 도달 확인, 실패 시 직접 이동
    if (!page.url().includes('/meeting/')) {
      logger.warn('예약 현황 페이지 미도달, 직접 이동 시도');
      await page.goto(`${config.mile.baseUrl}/meeting/schedule`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }

    // 다이얼로그 한번 더 닫기
    await this.dismissOverlays(page);

    // 회의실 위치 필터가 보일 때까지 대기
    try {
      await page.waitForSelector("input[placeholder='회의실 위치']", { timeout: 10_000 });
    } catch (error) {
      await this.captureScreenshot(page, 'debug-filter-not-found');
      logger.error('필터 대기 실패', { url: page.url(), error: (error as Error).message });
      throw error;
    }
  }

  /**
   * 오버레이/다이얼로그 닫기 (evaluate로 직접 DOM 클릭)
   */
  private async dismissOverlays(page: Page): Promise<void> {
    try {
      const dismissed = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const buttons = Array.from(doc.querySelectorAll('button')) as any[];
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text === '확인' || text === '닫기' || text === '취소') {
            // 다이얼로그 내부 버튼인지 확인 (모달/다이얼로그 컨테이너 내)
            const dialog = btn.closest('[role="dialog"], .modal, [class*="modal"], [class*="dialog"], [class*="overlay"]');
            if (dialog) {
              btn.click();
              return text;
            }
          }
        }
        return null;
      });
      if (dismissed) {
        logger.info('오버레이 닫음', { button: dismissed });
        await page.waitForTimeout(500);
      }
    } catch {
      // 무시
    }
  }

  async ensureAuthenticated(page: Page): Promise<void> {
    const currentUrl = page.url();
    if (currentUrl === 'about:blank' || currentUrl.includes('/login') || !this.authenticated) {
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
