// @ts-nocheck
/**
 * 예약 흐름 상세 분석 스크립트
 * - 예약하기 버튼 → 예약 폼 분석
 * - 전체 회의실 목록 수집
 * - 나의 예약/참석 페이지 분석
 * - 사이드바 네비게이션 분석
 *
 * 실행: node scripts/analyze-booking-flow.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function analyzeBookingFlow() {
  console.log('=== 예약 흐름 상세 분석 시작 ===\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const results = {};

  // .env에서 자격증명 로드
  let username = '', password = '';
  const dotenvPath = path.resolve('.env');
  if (fs.existsSync(dotenvPath)) {
    const env = fs.readFileSync(dotenvPath, 'utf-8');
    username = (env.match(/MILE_USERNAME=(.+)/)?.[1] || '').trim();
    password = (env.match(/MILE_PASSWORD=(.+)/)?.[1] || '').trim();
  }

  if (!username || !password) {
    console.log('❌ .env에 MILE_USERNAME/MILE_PASSWORD 필요');
    await browser.close();
    return;
  }

  try {
    // 1. 로그인
    console.log('[1/6] 로그인 중...');
    await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const idField = await page.$('input[placeholder="이메일 주소"]');
    const pwField = await page.$('input[type="password"]');
    await idField.fill(username);
    await pwField.fill(password);
    await page.waitForTimeout(500);

    const loginBtn = await page.$('button.button-solid-primary:not(.button-solid-disabled)');
    await loginBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log('  ✅ 로그인 성공');

    // 2. 워크스페이스 선택
    console.log('[2/6] 워크스페이스 선택...');
    if (page.url().includes('/workspace/list')) {
      const wsItem = await page.$(':has-text("서울창업허브")');
      if (wsItem) await wsItem.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
    console.log(`  - URL: ${page.url()}`);

    // 3. 사이드바 네비게이션 분석
    console.log('\n[3/6] 사이드바 네비게이션 분석...');
    const sidebar = await page.evaluate(() => {
      // 사이드바 메뉴 텍스트 수집
      const items = [];
      const allText = document.body.innerText;
      // 사이드바 영역의 p태그, div 등에서 메뉴 텍스트 찾기
      const sideTexts = [...document.querySelectorAll('p, span, div')]
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.left < 250 && rect.width < 250 && rect.width > 30 && el.textContent?.trim().length > 1 && el.textContent?.trim().length < 30;
        })
        .map(el => ({
          text: el.textContent?.trim(),
          tag: el.tagName,
          className: el.className,
          rect: (() => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; })(),
        }));
      return sideTexts;
    });
    results.sidebar = sidebar;
    const uniqueSidebar = [...new Set(sidebar.map(s => s.text))];
    console.log('  사이드바 항목:', uniqueSidebar.join(', '));

    // 4. 회의실 목록 전체 수집 (가로 스크롤)
    console.log('\n[4/6] 회의실 목록 수집...');
    const rooms = await page.evaluate(() => {
      // 상세 정보 링크 텍스트 주변의 회의실명 + 건물/층 정보
      const roomHeaders = [];
      const allElements = [...document.querySelectorAll('*')];

      // "상세 정보" 텍스트가 있는 요소의 부모 컨테이너에서 회의실 정보 추출
      const detailLinks = allElements.filter(el => el.textContent?.trim() === '상세 정보');
      detailLinks.forEach(link => {
        const parent = link.closest('div') || link.parentElement;
        const grandParent = parent?.parentElement;
        if (grandParent) {
          const texts = grandParent.innerText.split('\n').map(t => t.trim()).filter(Boolean);
          roomHeaders.push({
            texts,
            fullText: grandParent.innerText.trim().replace(/\n/g, ' | '),
          });
        }
      });

      return roomHeaders;
    });
    results.rooms = rooms;
    console.log(`  - 발견된 회의실: ${rooms.length}개`);
    rooms.forEach((r, i) => console.log(`    ${i + 1}. ${r.fullText}`));

    // 스크롤해서 더 많은 회의실 찾기 (» 버튼 클릭)
    console.log('  - 가로 스크롤로 추가 회의실 탐색...');
    const allRoomTexts = new Set(rooms.map(r => r.fullText));

    for (let scrollCount = 0; scrollCount < 10; scrollCount++) {
      // 스크린샷의 >> 버튼 위치 기반 클릭 (상단 회의실 헤더 영역)
      const rightBtns = await page.$$('button');
      let scrolled = false;
      for (const btn of rightBtns) {
        const box = await btn.boundingBox();
        const text = await btn.textContent().catch(() => '');
        // >> 버튼은 회의실 헤더 근처 (y ~200-270), 빈 텍스트
        if (box && box.top > 200 && box.top < 280 && box.left > 1100 && text === '') {
          await btn.click();
          await page.waitForTimeout(500);
          scrolled = true;
          break;
        }
      }
      if (!scrolled) break;

      const newRooms = await page.evaluate(() => {
        const detailLinks = [...document.querySelectorAll('*')].filter(el => el.textContent?.trim() === '상세 정보');
        return detailLinks.map(link => {
          const gp = link.closest('div')?.parentElement;
          return gp ? gp.innerText.trim().replace(/\n/g, ' | ') : '';
        }).filter(Boolean);
      });

      let foundNew = false;
      newRooms.forEach(r => { if (!allRoomTexts.has(r)) { allRoomTexts.add(r); foundNew = true; console.log(`    + ${r}`); } });
      if (!foundNew) break;
    }
    results.allRooms = [...allRoomTexts];
    console.log(`  - 총 회의실: ${allRoomTexts.size}개`);

    // 5. "예약하기" 버튼 클릭 → 예약 폼 분석
    console.log('\n[5/6] 예약하기 버튼 클릭하여 예약 폼 분석...');

    // "예약하기" 버튼 찾기 (상단 + 아이콘 버튼)
    const bookBtn = await page.$('button:has-text("예약하기"):not(.button-solid-disabled)');
    if (bookBtn) {
      await bookBtn.click();
      await page.waitForTimeout(2000);

      const bookingUrl = page.url();
      console.log(`  - 예약 폼 URL: ${bookingUrl}`);
      await page.screenshot({ path: 'logs/screenshots/booking-form.png', fullPage: true });
      fs.writeFileSync('logs/booking-form.html', await page.content(), 'utf-8');

      // 예약 폼 요소 분석
      const bookingForm = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input, select, textarea')].map(el => ({
          tag: el.tagName,
          type: el.type,
          name: el.name,
          id: el.id,
          className: el.className,
          placeholder: el.placeholder,
          value: el.value,
          options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, text: o.text })) : undefined,
        }));

        // 드롭다운/선택 요소 (커스텀 컴포넌트)
        const dropdowns = [...document.querySelectorAll('[class*="select"], [class*="dropdown"], [class*="picker"], [role="listbox"], [role="combobox"]')].map(el => ({
          tag: el.tagName,
          className: el.className,
          text: el.textContent?.trim().substring(0, 100),
          role: el.getAttribute('role'),
        }));

        // 라벨 텍스트 수집
        const labels = [...document.querySelectorAll('label, p[class*="label"], [class*="label"]')].map(el => ({
          text: el.textContent?.trim(),
          className: el.className,
          htmlFor: el.htmlFor || '',
        }));

        // 버튼
        const buttons = [...document.querySelectorAll('button')].map(el => ({
          text: el.textContent?.trim(),
          className: el.className,
          disabled: el.disabled || el.className.includes('disabled'),
        }));

        // 모달/다이얼로그 확인
        const modals = [...document.querySelectorAll('[class*="modal"], [class*="dialog"], [role="dialog"], [class*="overlay"]')].map(el => ({
          className: el.className,
          visible: el.offsetWidth > 0 && el.offsetHeight > 0,
          childCount: el.children.length,
        }));

        return { inputs, dropdowns, labels, buttons: buttons.filter(b => b.text), modals };
      });

      results.bookingForm = bookingForm;
      console.log(`  - 입력 필드: ${bookingForm.inputs.length}개`);
      bookingForm.inputs.forEach(i => console.log(`    ${i.tag}: type=${i.type} placeholder="${i.placeholder}" value="${i.value}" class="${i.className}"`));
      console.log(`  - 드롭다운: ${bookingForm.dropdowns.length}개`);
      bookingForm.dropdowns.forEach(d => console.log(`    ${d.tag}: class="${d.className}" text="${d.text}"`));
      console.log(`  - 라벨: ${bookingForm.labels.length}개`);
      bookingForm.labels.forEach(l => console.log(`    "${l.text}"`));
      console.log(`  - 버튼:`, bookingForm.buttons.filter(b => b.text).map(b => `"${b.text}"${b.disabled ? ' (disabled)' : ''}`).join(', '));
      console.log(`  - 모달:`, bookingForm.modals.length ? bookingForm.modals : 'none');

      // 뒤로 가기
      await page.goBack();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      console.log('  - "예약하기" 버튼을 찾을 수 없습니다.');
    }

    // 6. "나의 예약/참석" 페이지 탐색
    console.log('\n[6/6] "나의 예약/참석" 페이지 분석...');
    const myBookingLink = await page.$(':has-text("나의 예약")');
    if (myBookingLink) {
      await myBookingLink.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const myBookingUrl = page.url();
      console.log(`  - URL: ${myBookingUrl}`);
      results.myBookingUrl = myBookingUrl;

      await page.screenshot({ path: 'logs/screenshots/my-bookings.png', fullPage: true });
      fs.writeFileSync('logs/my-bookings.html', await page.content(), 'utf-8');

      const myBookingsPage = await page.evaluate(() => {
        const tables = [...document.querySelectorAll('table')].map(el => ({
          className: el.className,
          headers: [...el.querySelectorAll('th')].map(th => th.textContent?.trim()),
          rowCount: el.querySelectorAll('tbody tr').length,
        }));

        const listItems = [...document.querySelectorAll('[class*="item"], [class*="card"], [class*="booking"]')].map(el => ({
          className: el.className,
          text: el.textContent?.trim().substring(0, 200),
        })).filter(el => el.text.length > 10);

        const buttons = [...document.querySelectorAll('button')].map(el => ({
          text: el.textContent?.trim(),
          className: el.className,
        })).filter(b => b.text);

        const tabs = [...document.querySelectorAll('[class*="tab"], [role="tab"]')].map(el => ({
          text: el.textContent?.trim(),
          className: el.className,
          selected: el.getAttribute('aria-selected') || el.className.includes('active') || el.className.includes('selected'),
        }));

        return { tables, listItems: listItems.slice(0, 10), buttons: buttons.slice(0, 20), tabs, url: window.location.href };
      });

      results.myBookingsPage = myBookingsPage;
      console.log(`  - 테이블: ${myBookingsPage.tables.length}개`);
      myBookingsPage.tables.forEach(t => console.log(`    headers: ${t.headers.join(', ')}, rows: ${t.rowCount}`));
      console.log(`  - 탭: ${myBookingsPage.tabs.map(t => `"${t.text}"`).join(', ')}`);
      console.log(`  - 목록 항목: ${myBookingsPage.listItems.length}개`);
      myBookingsPage.listItems.slice(0, 3).forEach(l => console.log(`    "${l.text.substring(0, 80)}..."`));
    } else {
      console.log('  - "나의 예약" 메뉴를 찾을 수 없습니다.');
    }

  } catch (err) {
    console.error('오류:', err.message);
    await page.screenshot({ path: 'logs/screenshots/error-booking-flow.png', fullPage: true }).catch(() => {});
    results.error = err.message;
  } finally {
    fs.writeFileSync('logs/booking-flow-analysis.json', JSON.stringify(results, null, 2), 'utf-8');
    console.log('\n=== 분석 완료: logs/booking-flow-analysis.json ===');
    await browser.close();
  }
}

analyzeBookingFlow();
