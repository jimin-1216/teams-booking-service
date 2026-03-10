/**
 * 실제 사이트 대상 스크래퍼 E2E 테스트
 * 로그인 → 워크스페이스 → 예약현황 → 회의실 목록 파싱
 */
const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.MILE_USERNAME;
const PASSWORD = process.env.MILE_PASSWORD;
const WORKSPACE = '서울창업허브';

async function main() {
  console.log('=== 스크래퍼 E2E 테스트 시작 ===\n');

  const browser = await chromium.launch({ headless: false }); // 눈으로 확인용
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    // Step 1: 로그인
    console.log('[1/5] 로그인 페이지 접속...');
    await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const emailInput = await page.$("input[placeholder='이메일 주소']");
    if (!emailInput) throw new Error('이메일 입력란을 찾을 수 없음');
    await emailInput.fill(EMAIL);

    const pwInput = await page.$("input[type='password'][placeholder='비밀번호']");
    if (!pwInput) throw new Error('비밀번호 입력란을 찾을 수 없음');
    await pwInput.fill(PASSWORD);

    await page.waitForTimeout(500);

    const loginBtn = await page.$('button.button-solid-primary:not(.button-solid-disabled)');
    if (!loginBtn) throw new Error('로그인 버튼 비활성 상태');
    await loginBtn.click();

    await page.waitForURL('**/workspace/**', { timeout: 10000 });
    console.log('  ✅ 로그인 성공 → 워크스페이스 목록\n');

    // Step 2: 워크스페이스 선택
    console.log('[2/5] 워크스페이스 선택...');
    await page.waitForTimeout(2000);
    const wsLocator = page.locator(`:has-text("${WORKSPACE}")`).first();
    await wsLocator.click();
    await page.waitForTimeout(3000);
    console.log(`  ✅ "${WORKSPACE}" 선택 완료`);
    console.log(`  현재 URL: ${page.url()}\n`);

    // Step 3: 예약 현황 페이지 확인
    console.log('[3/5] 예약 현황 페이지 확인...');
    await page.waitForTimeout(2000);

    // 스크린샷 저장
    await page.screenshot({ path: 'logs/screenshots/test-booking-page.png', fullPage: true });
    console.log('  스크린샷: logs/screenshots/test-booking-page.png');

    // 타임그리드에서 "상세 정보" 찾기
    const detailCount = await page.evaluate(() => {
      const doc = (globalThis).document;
      const allEls = Array.from(doc.querySelectorAll('*'));
      return allEls.filter(el => el.textContent?.trim() === '상세 정보' && el.children.length === 0).length;
    });
    console.log(`  타임그리드 "상세 정보" 요소: ${detailCount}개\n`);

    // Step 4: 타임그리드에서 회의실 헤더 파싱
    console.log('[4/5] 회의실 목록 파싱 (타임그리드)...');
    const headers = await page.evaluate(() => {
      const results = [];
      const seenKeys = new Set();
      const doc = (globalThis).document;
      const allEls = Array.from(doc.querySelectorAll('*'));
      const detailEls = allEls.filter(
        el => el.textContent?.trim() === '상세 정보' && el.children.length === 0
      );

      detailEls.forEach((el, idx) => {
        const parent = el.closest?.('div')?.parentElement;
        if (!parent) return;
        const texts = parent.innerText.split('\n').map(t => t.trim()).filter(Boolean);
        if (texts.length >= 2) {
          const name = texts[0];
          const location = texts.find(t => t.includes('층') && t.includes('-')) || texts[1];
          const key = `${name}_${location}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({ name, location, colIndex: idx });
          }
        }
      });
      return results;
    });

    console.log(`  발견된 회의실: ${headers.length}개`);
    console.log('  ---');
    for (const h of headers) {
      // 건물/층 파싱
      const match = h.location.match(/(별관|본관)\s*-?\s*(\d+)\s*층/);
      const building = match ? match[1] : '?';
      const floor = match ? match[2] : '?';
      console.log(`  ${building} ${floor}층 | ${h.name} | (raw: ${h.location})`);
    }

    // 층별 카운트
    const floorCount = {};
    for (const h of headers) {
      const match = h.location.match(/(\d+)\s*층/);
      const floor = match ? match[1] : 'unknown';
      floorCount[floor] = (floorCount[floor] || 0) + 1;
    }
    console.log('\n  층별 회의실 수:');
    for (const [floor, count] of Object.entries(floorCount).sort()) {
      console.log(`    ${floor}층: ${count}개`);
    }

    // Step 5: 예약하기 버튼 → 예약 폼 열기 테스트
    console.log('\n[5/5] 예약 폼 열기 테스트...');
    const bookBtn = await page.$('button.button-solid-primary');
    if (bookBtn) {
      const btnText = await bookBtn.textContent();
      console.log(`  버튼 텍스트: "${btnText?.trim()}"`);

      if (btnText?.includes('예약하기')) {
        await bookBtn.click();
        await page.waitForTimeout(2000);

        // 폼 필드 확인
        const roomSearch = await page.$("input[placeholder='회의실 선택 (건물명, 회의실명 검색)']");
        const memoField = await page.$("textarea[placeholder='예약 메모']");
        const titleField = await page.$("input[placeholder='회의실 예약']");

        console.log(`  회의실 검색 필드: ${roomSearch ? '✅' : '❌'}`);
        console.log(`  예약 메모 필드: ${memoField ? '✅' : '❌'}`);
        console.log(`  예약 제목 필드: ${titleField ? '✅' : '❌'}`);

        await page.screenshot({ path: 'logs/screenshots/test-booking-form.png', fullPage: true });
        console.log('  스크린샷: logs/screenshots/test-booking-form.png');

        // 회의실 검색 드롭다운 테스트
        if (roomSearch) {
          await roomSearch.click();
          await page.waitForTimeout(1000);
          await roomSearch.fill('회의실');
          await page.waitForTimeout(1500);

          await page.screenshot({ path: 'logs/screenshots/test-room-dropdown.png', fullPage: true });
          console.log('  회의실 드롭다운 스크린샷: logs/screenshots/test-room-dropdown.png');
        }
      }
    } else {
      console.log('  ❌ 예약하기 버튼을 찾을 수 없음');
    }

    console.log('\n=== E2E 테스트 완료 ===');

  } catch (err) {
    console.error('\n❌ 테스트 실패:', err.message);
    await page.screenshot({ path: 'logs/screenshots/test-error.png', fullPage: true });
    console.log('에러 스크린샷: logs/screenshots/test-error.png');
  } finally {
    await page.waitForTimeout(3000); // 결과 확인 시간
    await browser.close();
  }
}

main();
