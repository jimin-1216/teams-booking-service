/**
 * 센터 예약 사이트(https://app.mile.im) 구조 분석 스크립트
 *
 * 실행: npx ts-node scripts/analyze-site.ts
 *
 * 로그인 페이지의 DOM 구조를 캡처하여 selectors.json 업데이트에 필요한 정보를 수집합니다.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function analyzeSite() {
  console.log('=== 센터 예약 사이트 구조 분석 시작 ===\n');

  const browser = await chromium.launch({ headless: false }); // GUI로 확인 가능
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  const results: Record<string, unknown> = {};

  try {
    // 1. 로그인 페이지 분석
    console.log('[1/4] 로그인 페이지 분석 중...');
    await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // React 렌더링 대기

    // 스크린샷
    await page.screenshot({ path: 'logs/screenshots/login-page.png', fullPage: true });
    console.log('  - 스크린샷 저장: logs/screenshots/login-page.png');

    // 전체 렌더링된 HTML 저장
    const loginHtml = await page.content();
    fs.writeFileSync('logs/login-page.html', loginHtml, 'utf-8');
    console.log('  - HTML 저장: logs/login-page.html');

    // 로그인 폼 분석
    const loginForm = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map((el) => ({
        type: el.type,
        name: el.name,
        id: el.id,
        className: el.className,
        placeholder: el.placeholder,
        'data-attributes': Object.keys(el.dataset).map(k => `data-${k}=${el.dataset[k]}`),
        selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : `input[type="${el.type}"]`,
      }));

      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]')).map((el) => ({
        type: (el as HTMLButtonElement).type || 'link',
        text: el.textContent?.trim(),
        id: el.id,
        className: el.className,
        'data-attributes': Object.keys((el as HTMLElement).dataset).map(k => `data-${k}=${(el as HTMLElement).dataset[k]}`),
      }));

      const forms = Array.from(document.querySelectorAll('form')).map((el) => ({
        action: el.action,
        method: el.method,
        id: el.id,
        className: el.className,
      }));

      const links = Array.from(document.querySelectorAll('a[href]')).map((el) => ({
        href: (el as HTMLAnchorElement).href,
        text: el.textContent?.trim(),
        className: el.className,
      }));

      // React 루트 확인
      const reactRoot = document.getElementById('root') || document.getElementById('app') || document.querySelector('[data-reactroot]');

      // 프레임워크 힌트
      const scripts = Array.from(document.querySelectorAll('script[src]')).map((el) => (el as HTMLScriptElement).src);

      return {
        inputs,
        buttons,
        forms,
        links,
        reactRoot: reactRoot ? { id: reactRoot.id, className: reactRoot.className } : null,
        scripts: scripts.filter(s => s.includes('chunk') || s.includes('bundle') || s.includes('main')),
        title: document.title,
        bodyClasses: document.body.className,
      };
    });

    results['loginPage'] = loginForm;
    console.log(`  - Input 필드: ${loginForm.inputs.length}개`);
    console.log(`  - 버튼: ${loginForm.buttons.length}개`);
    console.log(`  - 폼: ${loginForm.forms.length}개`);
    console.log(`  - 링크: ${loginForm.links.length}개`);

    // 2. 로그인 시도 (환경변수에서 자격증명 로드)
    const dotenvPath = path.resolve('.env');
    let username = '';
    let password = '';

    if (fs.existsSync(dotenvPath)) {
      const envContent = fs.readFileSync(dotenvPath, 'utf-8');
      const usernameMatch = envContent.match(/MILE_USERNAME=(.+)/);
      const passwordMatch = envContent.match(/MILE_PASSWORD=(.+)/);
      username = usernameMatch?.[1]?.trim() || '';
      password = passwordMatch?.[1]?.trim() || '';
    }

    if (username && password) {
      console.log('\n[2/4] 로그인 시도 중...');

      // 아이디/비밀번호 입력 시도 (다양한 셀렉터)
      const inputSelectors = [
        'input[placeholder="이메일 주소"]', 'input[type="email"]',
        'input[type="text"]', 'input[type="default"]',
        'input[name="username"]', 'input[name="email"]',
        'input[placeholder*="이메일"]', 'input[placeholder*="아이디"]',
      ];

      const passwordSelectors = [
        'input[type="password"]', 'input[name="password"]', '#password',
        'input[placeholder*="비밀번호"]', 'input[placeholder*="password"]',
      ];

      let usernameInput = null;
      for (const sel of inputSelectors) {
        usernameInput = await page.$(sel);
        if (usernameInput) {
          console.log(`  - 아이디 필드 발견: ${sel}`);
          results['usernameSelector'] = sel;
          break;
        }
      }

      let passwordInput = null;
      for (const sel of passwordSelectors) {
        passwordInput = await page.$(sel);
        if (passwordInput) {
          console.log(`  - 비밀번호 필드 발견: ${sel}`);
          results['passwordSelector'] = sel;
          break;
        }
      }

      if (usernameInput && passwordInput) {
        await usernameInput.fill(username);
        await passwordInput.fill(password);

        // 로그인 버튼 찾기
        const submitSelectors = [
          'button[type="submit"]', 'button:has-text("로그인")',
          'button:has-text("Login")', 'button:has-text("Sign in")',
          'input[type="submit"]', '.login-btn', '#login-button',
          'button.btn-primary', 'button[class*="login"]',
        ];

        let submitBtn = null;
        for (const sel of submitSelectors) {
          submitBtn = await page.$(sel);
          if (submitBtn) {
            console.log(`  - 로그인 버튼 발견: ${sel}`);
            results['submitSelector'] = sel;
            break;
          }
        }

        if (submitBtn) {
          await submitBtn.click();
          console.log('  - 로그인 버튼 클릭');

          // 로그인 후 페이지 대기
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(3000);

          const afterLoginUrl = page.url();
          console.log(`  - 로그인 후 URL: ${afterLoginUrl}`);
          results['afterLoginUrl'] = afterLoginUrl;

          // 로그인 성공 확인
          await page.screenshot({ path: 'logs/screenshots/after-login.png', fullPage: true });
          console.log('  - 스크린샷 저장: logs/screenshots/after-login.png');

          if (!afterLoginUrl.includes('/login')) {
            console.log('  ✅ 로그인 성공!');

            // 3. 로그인 후 메인 페이지 분석
            console.log('\n[3/4] 메인 페이지 구조 분석 중...');

            const mainPageHtml = await page.content();
            fs.writeFileSync('logs/main-page.html', mainPageHtml, 'utf-8');

            const mainPage = await page.evaluate(() => {
              // 네비게이션 메뉴
              const navLinks = Array.from(document.querySelectorAll('nav a, .nav a, [class*="menu"] a, [class*="sidebar"] a, header a')).map((el) => ({
                href: (el as HTMLAnchorElement).href,
                text: el.textContent?.trim(),
                className: el.className,
              }));

              // 모든 클릭 가능 요소
              const clickables = Array.from(document.querySelectorAll('button, a[href], [role="button"], [class*="btn"]')).map((el) => ({
                tag: el.tagName,
                text: el.textContent?.trim().substring(0, 50),
                href: (el as HTMLAnchorElement).href || '',
                className: el.className,
                id: el.id,
              }));

              // 주요 컨테이너 클래스
              const containers = Array.from(document.querySelectorAll('[class*="container"], [class*="wrapper"], [class*="content"], main, section')).map((el) => ({
                tag: el.tagName,
                className: el.className,
                id: el.id,
                childCount: el.children.length,
              }));

              return { navLinks, clickables, containers };
            });

            results['mainPage'] = mainPage;
            console.log(`  - 네비게이션 링크: ${mainPage.navLinks.length}개`);
            console.log(`  - 클릭 가능 요소: ${mainPage.clickables.length}개`);

            // 4. 예약 관련 페이지 탐색
            console.log('\n[4/4] 예약 관련 페이지 탐색 중...');

            // 예약 관련 링크 찾기
            const bookingLinks = mainPage.navLinks.filter(l =>
              l.text?.includes('예약') || l.text?.includes('회의') ||
              l.text?.includes('booking') || l.text?.includes('reserve') ||
              l.href?.includes('booking') || l.href?.includes('reserve') ||
              l.href?.includes('room') || l.href?.includes('space')
            );

            const allBookingClickables = mainPage.clickables.filter(c =>
              c.text?.includes('예약') || c.text?.includes('회의') ||
              c.text?.includes('booking') || c.text?.includes('공간') ||
              c.href?.includes('booking') || c.href?.includes('reserve') ||
              c.href?.includes('room') || c.href?.includes('space')
            );

            results['bookingLinks'] = bookingLinks;
            results['bookingClickables'] = allBookingClickables;
            console.log(`  - 예약 관련 링크: ${bookingLinks.length}개`);
            console.log(`  - 예약 관련 클릭 요소: ${allBookingClickables.length}개`);

            // 예약 페이지로 이동 시도
            if (bookingLinks.length > 0) {
              const firstBookingLink = bookingLinks[0];
              console.log(`  - 예약 페이지 이동 시도: ${firstBookingLink.href}`);
              await page.goto(firstBookingLink.href, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(3000);

              await page.screenshot({ path: 'logs/screenshots/booking-page.png', fullPage: true });
              const bookingHtml = await page.content();
              fs.writeFileSync('logs/booking-page.html', bookingHtml, 'utf-8');

              const bookingPage = await page.evaluate(() => {
                // 예약 폼 요소들
                const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
                  tag: el.tagName,
                  type: (el as HTMLInputElement).type,
                  name: (el as HTMLInputElement).name,
                  id: el.id,
                  className: el.className,
                  placeholder: (el as HTMLInputElement).placeholder,
                  options: el.tagName === 'SELECT'
                    ? Array.from((el as HTMLSelectElement).options).map(o => ({ value: o.value, text: o.text }))
                    : undefined,
                }));

                // 테이블/리스트 구조 (회의실 목록)
                const tables = Array.from(document.querySelectorAll('table')).map((el) => ({
                  id: el.id,
                  className: el.className,
                  headers: Array.from(el.querySelectorAll('th')).map(th => th.textContent?.trim()),
                  rowCount: el.querySelectorAll('tbody tr').length,
                }));

                const lists = Array.from(document.querySelectorAll('[class*="room"], [class*="space"], [class*="list"]')).map((el) => ({
                  tag: el.tagName,
                  className: el.className,
                  id: el.id,
                  childCount: el.children.length,
                  firstChildClass: el.children[0]?.className,
                }));

                // 캘린더/날짜 선택기
                const dateElements = Array.from(document.querySelectorAll('[class*="calendar"], [class*="date"], [class*="picker"], input[type="date"]')).map((el) => ({
                  tag: el.tagName,
                  className: el.className,
                  id: el.id,
                  type: (el as HTMLInputElement).type,
                }));

                return { inputs, tables, lists, dateElements, url: window.location.href };
              });

              results['bookingPage'] = bookingPage;
              console.log(`  - 예약 페이지 입력 요소: ${bookingPage.inputs.length}개`);
              console.log(`  - 테이블: ${bookingPage.tables.length}개`);
              console.log(`  - 목록 요소: ${bookingPage.lists.length}개`);
              console.log(`  - 날짜 요소: ${bookingPage.dateElements.length}개`);
            }
          } else {
            console.log('  ❌ 로그인 실패 (여전히 로그인 페이지)');
            results['loginFailed'] = true;
          }
        }
      } else {
        console.log('\n[2/4] .env 파일에 MILE_USERNAME/MILE_PASSWORD가 없어 로그인 스킵');
        results['noCredentials'] = true;
      }
    } else {
      console.log('\n[2/4] .env 파일 없음. 로그인 분석 스킵');
      results['noEnvFile'] = true;
    }

  } catch (error) {
    console.error('분석 중 오류:', (error as Error).message);
    results['error'] = (error as Error).message;
  } finally {
    // 결과 저장
    const outputPath = 'logs/site-analysis.json';
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n=== 분석 결과 저장: ${outputPath} ===`);

    await browser.close();
  }
}

analyzeSite();
