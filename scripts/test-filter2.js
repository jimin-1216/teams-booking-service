/**
 * 필터 필드: 클릭 → 드롭다운 → 옵션 선택 방식 테스트
 */
const { chromium } = require('playwright');
require('dotenv').config();

async function login(page) {
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
}

async function getRoomHeaders(page) {
  const raw = await page.evaluate(() => {
    const doc = (globalThis).document;
    const allEls = Array.from(doc.querySelectorAll('*'));
    const detailEls = allEls.filter(
      el => el.textContent?.trim() === '상세 정보' && el.children.length === 0
    );
    return detailEls.map(el => {
      const parent = el.closest?.('div')?.parentElement;
      if (!parent) return null;
      const texts = parent.innerText.split('\n').map(t => t.trim()).filter(Boolean);
      if (texts.length >= 2) {
        return {
          name: texts[0],
          location: texts.find(t => t.includes('층') && t.includes('-')) || texts[1],
        };
      }
      return null;
    }).filter(Boolean);
  });

  const rooms = [];
  const seen = new Set();
  for (const h of raw) {
    const key = `${h.name}_${h.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const match = h.location.match(/(별관|본관)\s*-?\s*(\d+)\s*층/);
    rooms.push({
      name: h.name,
      building: match ? match[1] : '?',
      floor: match ? parseInt(match[2]) : 0,
    });
  }
  return rooms;
}

async function scrollAndCollectAll(page) {
  // 스크롤 초기화
  await page.evaluate(() => {
    const doc = (globalThis).document;
    for (const div of doc.querySelectorAll('div')) {
      if (div.scrollWidth > div.clientWidth + 50 && div.getBoundingClientRect().y > 150 && div.getBoundingClientRect().height > 200) {
        div.scrollLeft = 0;
        break;
      }
    }
  });
  await page.waitForTimeout(500);

  const allRooms = new Map();
  let attempts = 0;

  while (attempts < 30) {
    const rooms = await getRoomHeaders(page);
    for (const r of rooms) {
      const key = `${r.name}_${r.building}_${r.floor}`;
      if (!allRooms.has(key)) allRooms.set(key, r);
    }

    const canScroll = await page.evaluate(() => {
      const doc = (globalThis).document;
      for (const div of doc.querySelectorAll('div')) {
        if (div.scrollWidth > div.clientWidth + 50 && div.getBoundingClientRect().y > 150 && div.getBoundingClientRect().height > 200) {
          const before = div.scrollLeft;
          div.scrollLeft += 400;
          return div.scrollLeft > before;
        }
      }
      return false;
    });

    if (!canScroll) break;
    await page.waitForTimeout(300);
    attempts++;
  }

  return Array.from(allRooms.values()).sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));
}

async function main() {
  console.log('=== 필터 + 스크롤 테스트 ===\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    await login(page);
    console.log('로그인 완료\n');

    // Step 1: 필터 없이 전체 목록 (스크롤)
    console.log('[1] 필터 없이 전체 목록...');
    const allRooms = await scrollAndCollectAll(page);
    console.log(`  총 ${allRooms.length}개`);
    let pf = 0;
    for (const r of allRooms) {
      if (r.floor !== pf) { console.log(`  [${r.floor}층 ${r.building}]`); pf = r.floor; }
      console.log(`    ${r.name}`);
    }

    // Step 2: "회의실 위치" 필터 클릭
    console.log('\n[2] "회의실 위치" 필터 클릭...');
    const locationFilter = await page.$("input[placeholder='회의실 위치']");
    if (locationFilter) {
      await locationFilter.click();
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'logs/screenshots/test-filter2-location-dropdown.png', fullPage: true });

      // 드롭다운에서 모든 옵션 텍스트 수집
      const options = await page.evaluate(() => {
        const doc = (globalThis).document;
        const results = [];
        // 팝업/드롭다운/오버레이 찾기
        const allEls = Array.from(doc.querySelectorAll('div, li, span, p, button'));
        allEls.forEach(el => {
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.trim();
          // 필터 드롭다운 영역 (필터 아래에 나타남)
          if (text && rect.y > 180 && rect.y < 500 && rect.x > 300 && rect.x < 800
              && rect.height > 10 && rect.height < 60 && text.length < 30
              && el.children.length <= 2) {
            results.push({
              text,
              tag: el.tagName,
              className: (el.className?.toString() || '').substring(0, 60),
              y: Math.round(rect.y),
            });
          }
        });
        // 중복 제거
        const seen = new Set();
        return results.filter(r => {
          if (seen.has(r.text)) return false;
          seen.add(r.text);
          return true;
        });
      });

      console.log(`  드롭다운 옵션: ${options.length}개`);
      for (const opt of options) {
        console.log(`    [${opt.tag}] "${opt.text}" y=${opt.y} class=${opt.className}`);
      }

      // "본관" 옵션 클릭
      console.log('\n  "본관" 클릭 시도...');
      try {
        // 정확히 "본관"만 있는 요소 클릭
        const bonganOption = page.locator('div, li, span, p').filter({ hasText: /^본관$/ }).first();
        await bonganOption.click({ timeout: 5000 });
        console.log('  ✅ "본관" 클릭 성공');
      } catch {
        console.log('  정확한 매칭 실패, 포함 매칭 시도...');
        try {
          await page.locator('text=본관').first().click({ timeout: 5000 });
          console.log('  ✅ "본관" 클릭 성공 (text locator)');
        } catch (e2) {
          console.log('  ❌ 클릭 실패:', e2.message.substring(0, 100));
        }
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'logs/screenshots/test-filter2-location-applied.png', fullPage: true });

      // 필터 적용 후 회의실 목록
      const filteredRooms = await scrollAndCollectAll(page);
      console.log(`\n  본관 필터 적용 후: ${filteredRooms.length}개`);
      pf = 0;
      for (const r of filteredRooms) {
        if (r.floor !== pf) { console.log(`  [${r.floor}층]`); pf = r.floor; }
        console.log(`    ${r.name}`);
      }
    }

    // Step 3: 회의실 이름 필터도 같은 방식인지 확인
    console.log('\n[3] "회의실 이름" 필터...');
    const roomFilter = await page.$("input[placeholder='회의실 이름']");
    if (roomFilter) {
      await roomFilter.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'logs/screenshots/test-filter2-room-dropdown.png', fullPage: true });

      const roomOptions = await page.evaluate(() => {
        const doc = (globalThis).document;
        const results = [];
        const seen = new Set();
        const allEls = Array.from(doc.querySelectorAll('div, li, span, p, button'));
        allEls.forEach(el => {
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.trim();
          if (text && rect.y > 180 && rect.y < 600 && rect.x > 600
              && rect.height > 10 && rect.height < 60 && text.length < 50
              && el.children.length <= 3 && !seen.has(text)) {
            seen.add(text);
            results.push({ text, tag: el.tagName, y: Math.round(rect.y) });
          }
        });
        return results;
      });

      console.log(`  회의실 이름 옵션: ${roomOptions.length}개`);
      for (const opt of roomOptions) {
        console.log(`    [${opt.tag}] "${opt.text}"`);
      }
    }

    console.log('\n=== 완료 ===');

  } catch (err) {
    console.error('실패:', err.message);
    await page.screenshot({ path: 'logs/screenshots/test-filter2-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

main();
