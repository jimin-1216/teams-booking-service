/**
 * 드롭다운 요소와 스크롤 버튼의 실제 DOM 구조 파악
 */
const { chromium } = require('playwright');
require('dotenv').config();

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    // 로그인
    await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.fill("input[placeholder='이메일 주소']", process.env.MILE_USERNAME);
    await page.fill("input[type='password'][placeholder='비밀번호']", process.env.MILE_PASSWORD);
    await page.waitForTimeout(500);
    await page.click('button.button-solid-primary:not(.button-solid-disabled)');
    await page.waitForURL('**/workspace/**', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.locator(':has-text("서울창업허브")').first().click();
    await page.waitForTimeout(3000);
    console.log('로그인 완료\n');

    // === 1. 타임그리드 스크롤 버튼 탐색 ===
    console.log('=== 스크롤 버튼 탐색 ===');

    // 스크린샷에서 보이는 화살표(>, >>)의 실제 DOM 찾기
    const scrollInfo = await page.evaluate(() => {
      const doc = (globalThis).document;
      const results = [];

      // SVG 화살표나 > >> 텍스트를 포함하는 클릭 가능 요소
      const allEls = Array.from(doc.querySelectorAll('button, a, div[role="button"], span[role="button"], svg, [class*="arrow"], [class*="scroll"], [class*="nav"], [class*="next"], [class*="prev"]'));

      allEls.forEach(el => {
        const rect = el.getBoundingClientRect();
        // 화면에 보이는 요소만
        if (rect.width > 0 && rect.height > 0 && rect.y > 180 && rect.y < 320) {
          results.push({
            tag: el.tagName,
            className: (el.className?.toString() || '').substring(0, 80),
            text: (el.textContent || '').trim().substring(0, 30),
            innerHTML: el.innerHTML.substring(0, 100),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          });
        }
      });

      return results;
    });

    console.log(`헤더 영역 클릭 가능 요소: ${scrollInfo.length}개`);
    for (const el of scrollInfo) {
      console.log(`  [${el.tag}] x=${el.x} y=${el.y} w=${el.w} h=${el.h}`);
      console.log(`    class: ${el.className}`);
      console.log(`    text: "${el.text}"`);
      if (el.innerHTML.includes('svg') || el.innerHTML.includes('path')) {
        console.log(`    (SVG 아이콘 포함)`);
      }
      console.log();
    }

    // 더 넓게 찾기 - 화살표 기호 포함 요소
    const arrowEls = await page.evaluate(() => {
      const doc = (globalThis).document;
      const results = [];
      const walker = doc.createTreeWalker(doc.body, 1 /* SHOW_ELEMENT */);
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const rect = node.getBoundingClientRect();
        // ">" ">>" "«" "»" "‹" "›" 문자만 포함하는 작은 요소
        if (text && /^[>»›<«‹]{1,2}$/.test(text) && rect.width > 0 && rect.width < 60) {
          results.push({
            tag: node.tagName,
            className: (node.className?.toString() || '').substring(0, 50),
            text,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          });
        }
      }
      return results;
    });

    console.log(`화살표 문자 요소: ${arrowEls.length}개`);
    for (const el of arrowEls) {
      console.log(`  [${el.tag}] "${el.text}" x=${el.x} y=${el.y} class=${el.className}`);
    }

    // === 2. 예약 폼 열고 드롭다운 구조 파악 ===
    console.log('\n=== 예약 폼 드롭다운 구조 ===');
    await page.click('button:has-text("예약하기")');
    await page.waitForTimeout(2000);

    // 회의실 검색 필드
    const roomInput = await page.$("input[placeholder='회의실 선택 (건물명, 회의실명 검색)']");
    if (!roomInput) {
      // placeholder가 다를 수 있음
      console.log('정확한 placeholder 못찾음, 모든 input 확인:');
      const allInputs = await page.evaluate(() => {
        const doc = (globalThis).document;
        return Array.from(doc.querySelectorAll('input')).map(el => ({
          placeholder: el.placeholder,
          type: el.type,
          value: el.value,
          className: el.className?.substring(0, 50),
        }));
      });
      for (const inp of allInputs) {
        console.log(`  [${inp.type}] placeholder="${inp.placeholder}" value="${inp.value}" class="${inp.className}"`);
      }
    }

    // 회의실 필드 클릭 (여러 방법 시도)
    const roomField = await page.$("input[placeholder*='회의실']");
    if (roomField) {
      console.log('\n회의실 필드 찾음, 클릭...');
      await roomField.click();
      await page.waitForTimeout(1500);

      // 드롭다운 스크린샷
      await page.screenshot({ path: 'logs/screenshots/test-dropdown-debug.png', fullPage: true });

      // 드롭다운 영역 모든 요소 파악
      const dropdownEls = await page.evaluate(() => {
        const doc = (globalThis).document;
        const results = [];

        // 모든 요소 중 "층"을 포함하는 것 탐색
        const walker = doc.createTreeWalker(doc.body, 1);
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent?.trim();
          const rect = node.getBoundingClientRect();
          if (text && text.includes('층') && rect.width > 50 && rect.height > 10 && rect.height < 100
              && text.length < 100 && node.children.length <= 3) {
            results.push({
              tag: node.tagName,
              className: (node.className?.toString() || '').substring(0, 80),
              text: text.substring(0, 80),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
              childCount: node.children.length,
            });
          }
        }
        return results.slice(0, 30);
      });

      console.log(`\n"층" 포함 요소: ${dropdownEls.length}개`);
      for (const el of dropdownEls) {
        console.log(`  [${el.tag}] ${el.w}x${el.h} @ (${el.x},${el.y})`);
        console.log(`    class: ${el.className}`);
        console.log(`    text: "${el.text}"`);
        console.log();
      }

      // 검색어 입력 후 결과
      console.log('\n"회의실" 검색 후:');
      await roomField.fill('회의실');
      await page.waitForTimeout(1500);

      await page.screenshot({ path: 'logs/screenshots/test-dropdown-search.png', fullPage: true });

      const searchResults = await page.evaluate(() => {
        const doc = (globalThis).document;
        const results = [];
        const walker = doc.createTreeWalker(doc.body, 1);
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent?.trim();
          const rect = node.getBoundingClientRect();
          // 드롭다운 영역 (대략 우측 패널의 회의실 필드 아래)
          if (text && text.includes('층') && rect.x > 800 && rect.y > 450
              && rect.width > 50 && rect.height > 10 && rect.height < 80
              && text.length < 100 && node.children.length <= 5) {
            results.push({
              tag: node.tagName,
              className: (node.className?.toString() || '').substring(0, 80),
              text: text.replace(/\n/g, ' ').substring(0, 100),
              rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
            });
          }
        }
        return results.slice(0, 20);
      });

      console.log(`검색 결과 요소: ${searchResults.length}개`);
      for (const el of searchResults) {
        console.log(`  [${el.tag}] "${el.text}"`);
        console.log(`    class: ${el.className}`);
        console.log(`    rect: ${el.rect}`);
      }
    }

    console.log('\n=== 완료 ===');

  } catch (err) {
    console.error('실패:', err.message);
    await page.screenshot({ path: 'logs/screenshots/test-elements-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

main();
