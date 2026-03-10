// @ts-nocheck
/**
 * 센터 예약 사이트(https://app.mile.im) 구조 분석 스크립트
 * 실행: node scripts/analyze-site.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function analyzeSite() {
  console.log('=== 센터 예약 사이트 구조 분석 시작 ===\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const results = {};

  try {
    // 1. 로그인 페이지 분석
    console.log('[1/4] 로그인 페이지 로딩 중...');
    await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'logs/screenshots/login-page.png', fullPage: true });
    console.log('  - 스크린샷: logs/screenshots/login-page.png');

    const loginHtml = await page.content();
    fs.writeFileSync('logs/login-page.html', loginHtml, 'utf-8');
    console.log('  - HTML 저장: logs/login-page.html');

    // 로그인 폼 분석
    const loginForm = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].map(el => ({
        type: el.type, name: el.name, id: el.id,
        className: el.className, placeholder: el.placeholder,
        selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : `input[type="${el.type}"]`,
      }));
      const buttons = [...document.querySelectorAll('button, input[type="submit"]')].map(el => ({
        type: el.type || 'button', text: el.textContent?.trim(),
        id: el.id, className: el.className,
      }));
      const forms = [...document.querySelectorAll('form')].map(el => ({
        action: el.action, method: el.method, id: el.id, className: el.className,
      }));
      const links = [...document.querySelectorAll('a[href]')].map(el => ({
        href: el.href, text: el.textContent?.trim(), className: el.className,
      }));
      const scripts = [...document.querySelectorAll('script[src]')].map(el => el.src);
      return {
        inputs, buttons, forms, links, title: document.title,
        scripts: scripts.filter(s => s.includes('chunk') || s.includes('bundle') || s.includes('main')),
      };
    });

    results.loginPage = loginForm;
    console.log(`  - Input: ${loginForm.inputs.length}개, 버튼: ${loginForm.buttons.length}개`);
    loginForm.inputs.forEach(i => console.log(`    input: type=${i.type} name=${i.name} id=${i.id} placeholder="${i.placeholder}" class="${i.className}"`));
    loginForm.buttons.forEach(b => console.log(`    button: type=${b.type} text="${b.text}" class="${b.className}"`));

    // 2. 로그인 시도
    let username = '', password = '';
    const dotenvPath = path.resolve('.env');
    if (fs.existsSync(dotenvPath)) {
      const env = fs.readFileSync(dotenvPath, 'utf-8');
      username = (env.match(/MILE_USERNAME=(.+)/)?.[1] || '').trim();
      password = (env.match(/MILE_PASSWORD=(.+)/)?.[1] || '').trim();
    }

    if (username && password) {
      console.log('\n[2/4] 로그인 시도 중...');

      // 아이디 필드 탐색 (마일 사이트: placeholder 기반, name/id 없음)
      const idSelectors = ['input[placeholder="이메일 주소"]', 'input[type="email"]', 'input[type="text"]', 'input[type="default"]', 'input[name="username"]', 'input[name="email"]'];
      const pwSelectors = ['input[type="password"][placeholder="비밀번호"]', 'input[type="password"]', 'input[name="password"]'];

      let foundId = null, foundPw = null;
      for (const s of idSelectors) { foundId = await page.$(s); if (foundId) { console.log(`  - ID필드: ${s}`); results.usernameSelector = s; break; } }
      for (const s of pwSelectors) { foundPw = await page.$(s); if (foundPw) { console.log(`  - PW필드: ${s}`); results.passwordSelector = s; break; } }

      if (foundId && foundPw) {
        await foundId.fill(username);
        await foundPw.fill(password);

        // 입력 후 React 상태 반영 대기 (버튼 disabled → enabled)
        await page.waitForTimeout(1000);

        const btnSelectors = ['button.button-solid-primary:not(.button-solid-disabled)', 'button:has-text("로그인"):not(.button-solid-disabled)', 'button[type="submit"]'];
        let foundBtn = null;
        for (const s of btnSelectors) { foundBtn = await page.$(s); if (foundBtn) { console.log(`  - 버튼: ${s}`); results.submitSelector = s; break; } }

        if (foundBtn) {
          await foundBtn.click();
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(3000);

          const afterUrl = page.url();
          console.log(`  - 로그인 후 URL: ${afterUrl}`);
          results.afterLoginUrl = afterUrl;
          await page.screenshot({ path: 'logs/screenshots/after-login.png', fullPage: true });

          if (!afterUrl.includes('/login')) {
            console.log('  ✅ 로그인 성공!\n');

            // 2.5. 워크스페이스 선택 (로그인 후 /workspace/list 일 경우)
            if (afterUrl.includes('/workspace/list')) {
              console.log('[2.5/4] 워크스페이스 선택 페이지 감지...');
              await page.screenshot({ path: 'logs/screenshots/workspace-list.png', fullPage: true });
              fs.writeFileSync('logs/workspace-list.html', await page.content(), 'utf-8');

              // 워크스페이스 항목 클릭 (첫 번째 워크스페이스 선택)
              const wsItem = await page.$('div[style*="cursor"] >> text=서울창업허브') ||
                             await page.$('[class*="workspace"] >> nth=0') ||
                             await page.$('text=서울창업허브');
              if (!wsItem) {
                // 클릭 가능한 행 찾기 (> 아이콘이 있는 row)
                const wsRow = await page.$(':has-text("서울창업허브")');
                if (wsRow) {
                  console.log('  - 워크스페이스 항목 발견, 클릭...');
                  await wsRow.click();
                } else {
                  console.log('  - 워크스페이스 항목을 찾을 수 없습니다.');
                }
              } else {
                console.log('  - 워크스페이스 "서울창업허브" 클릭...');
                await wsItem.click();
              }
              await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(3000);
              const wsUrl = page.url();
              console.log(`  - 워크스페이스 진입 후 URL: ${wsUrl}`);
              results.workspaceUrl = wsUrl;
              await page.screenshot({ path: 'logs/screenshots/workspace-home.png', fullPage: true });
            }

            // 3. 메인 페이지 분석
            console.log('[3/4] 메인 페이지 구조 분석...');
            fs.writeFileSync('logs/main-page.html', await page.content(), 'utf-8');

            const mainPage = await page.evaluate(() => {
              const navLinks = [...document.querySelectorAll('nav a, .nav a, header a, aside a, [class*="menu"] a, [class*="sidebar"] a, [class*="nav"] a')].map(el => ({
                href: el.href, text: el.textContent?.trim(), className: el.className,
              }));
              const clickables = [...document.querySelectorAll('button, a[href], [role="button"]')].map(el => ({
                tag: el.tagName, text: el.textContent?.trim().substring(0, 80),
                href: el.href || '', className: el.className, id: el.id,
              }));
              return { navLinks, clickables, url: window.location.href };
            });

            results.mainPage = mainPage;
            console.log(`  - 네비게이션: ${mainPage.navLinks.length}개`);
            mainPage.navLinks.forEach(l => console.log(`    [nav] "${l.text}" → ${l.href}`));
            console.log(`  - 클릭 요소: ${mainPage.clickables.length}개`);

            // 4. 예약 관련 페이지 탐색
            console.log('\n[4/4] 예약 관련 페이지 탐색...');
            const bookingLinks = mainPage.navLinks.filter(l =>
              (l.text && (l.text.includes('예약') || l.text.includes('회의') || l.text.includes('공간') || l.text.includes('booking') || l.text.includes('room'))) ||
              (l.href && (l.href.includes('booking') || l.href.includes('reserve') || l.href.includes('room') || l.href.includes('space')))
            );
            results.bookingLinks = bookingLinks;
            bookingLinks.forEach(l => console.log(`  - 예약링크: "${l.text}" → ${l.href}`));

            if (bookingLinks.length > 0) {
              console.log(`  → ${bookingLinks[0].href} 이동...`);
              await page.goto(bookingLinks[0].href, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(3000);
              await page.screenshot({ path: 'logs/screenshots/booking-page.png', fullPage: true });
              fs.writeFileSync('logs/booking-page.html', await page.content(), 'utf-8');

              const bookingPage = await page.evaluate(() => {
                const inputs = [...document.querySelectorAll('input, select, textarea')].map(el => ({
                  tag: el.tagName, type: el.type, name: el.name, id: el.id,
                  className: el.className, placeholder: el.placeholder,
                  options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, text: o.text })) : undefined,
                }));
                const tables = [...document.querySelectorAll('table')].map(el => ({
                  className: el.className,
                  headers: [...el.querySelectorAll('th')].map(th => th.textContent?.trim()),
                  rowCount: el.querySelectorAll('tbody tr').length,
                }));
                const roomLike = [...document.querySelectorAll('[class*="room"], [class*="space"], [class*="seat"], [class*="desk"]')].map(el => ({
                  tag: el.tagName, className: el.className, id: el.id,
                  text: el.textContent?.trim().substring(0, 100),
                  childCount: el.children.length,
                }));
                return { inputs, tables, roomLike, url: window.location.href };
              });

              results.bookingPage = bookingPage;
              console.log(`  - 입력 요소: ${bookingPage.inputs.length}개`);
              bookingPage.inputs.forEach(i => console.log(`    ${i.tag}: type=${i.type} name=${i.name} id=${i.id} placeholder="${i.placeholder}"`));
              console.log(`  - 테이블: ${bookingPage.tables.length}개`);
              console.log(`  - Room/Space 요소: ${bookingPage.roomLike.length}개`);
              bookingPage.roomLike.slice(0, 10).forEach(r => console.log(`    [${r.tag}] class="${r.className}" → "${r.text?.substring(0, 60)}"`));
            } else {
              // 예약 링크 못 찾으면 모든 링크 출력
              console.log('  - 예약 관련 링크를 찾지 못했습니다. 전체 링크 목록:');
              mainPage.clickables.filter(c => c.tag === 'A').forEach(c => console.log(`    "${c.text}" → ${c.href}`));
            }
          } else {
            console.log('  ❌ 로그인 실패');
          }
        }
      }
    } else {
      console.log('\n⚠️ .env 파일에 MILE_USERNAME/MILE_PASSWORD를 설정한 후 다시 실행해주세요.');
    }
  } catch (err) {
    console.error('오류:', err.message);
    await page.screenshot({ path: 'logs/screenshots/error.png', fullPage: true }).catch(() => {});
    results.error = err.message;
  } finally {
    fs.writeFileSync('logs/site-analysis.json', JSON.stringify(results, null, 2), 'utf-8');
    console.log('\n=== 분석 완료: logs/site-analysis.json ===');
    await browser.close();
  }
}

analyzeSite();
