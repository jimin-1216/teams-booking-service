/**
 * 예약 현황 페이지 필터 기능 테스트
 * "회의실 위치" + "회의실 이름" 필터 → 타임그리드 파싱
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

function parseRoomHeaders(rawHeaders) {
  const rooms = [];
  const seen = new Set();
  for (const h of rawHeaders) {
    const key = `${h.name}_${h.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const match = h.location.match(/(별관|본관)\s*-?\s*(\d+)\s*층/);
    rooms.push({
      name: h.name,
      building: match ? match[1] : '?',
      floor: match ? parseInt(match[2]) : 0,
      location: h.location,
    });
  }
  return rooms;
}

async function getRoomHeaders(page) {
  return page.evaluate(() => {
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
}

async function main() {
  console.log('=== 필터 기능 테스트 ===\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    await login(page);
    console.log('로그인 완료\n');

    // Step 1: 필터 필드 탐색
    console.log('[1] 필터 필드 확인...');
    const filterInfo = await page.evaluate(() => {
      const doc = (globalThis).document;
      const inputs = Array.from(doc.querySelectorAll('input'));
      return inputs.map(el => ({
        placeholder: el.placeholder || '',
        value: el.value || '',
        type: el.type,
        className: (el.className || '').substring(0, 60),
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
      })).filter(i => i.y > 100 && i.y < 250); // 필터 영역
    });

    for (const f of filterInfo) {
      console.log(`  placeholder="${f.placeholder}" type=${f.type} @ (${f.x}, ${f.y})`);
    }

    // Step 2: "회의실 위치" 필터 테스트
    console.log('\n[2] "회의실 위치" 필터로 "본관" 검색...');
    const locationFilter = await page.$("input[placeholder='회의실 위치']");
    if (locationFilter) {
      await locationFilter.click();
      await page.waitForTimeout(500);
      await locationFilter.fill('본관');
      await page.waitForTimeout(1500);

      // 드롭다운 나오는지 확인
      await page.screenshot({ path: 'logs/screenshots/test-filter-location.png', fullPage: true });

      // 드롭다운 항목 클릭 시도
      const locationOption = await page.locator('text=본관').first();
      if (locationOption) {
        try {
          await locationOption.click({ timeout: 3000 });
          await page.waitForTimeout(2000);
          console.log('  "본관" 선택 완료');
        } catch {
          console.log('  드롭다운 클릭 실패, Enter 시도...');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }
      }

      await page.screenshot({ path: 'logs/screenshots/test-filter-location-applied.png', fullPage: true });

      // 필터 적용 후 회의실 확인
      const headers = await getRoomHeaders(page);
      const rooms = parseRoomHeaders(headers);
      console.log(`  필터 적용 후 회의실: ${rooms.length}개`);
      for (const r of rooms) {
        console.log(`    ${r.building} ${r.floor}층 | ${r.name}`);
      }
    } else {
      console.log('  "회의실 위치" 필드를 찾을 수 없음');

      // placeholder가 다를 수 있음
      const allPlaceholders = await page.evaluate(() => {
        const doc = (globalThis).document;
        return Array.from(doc.querySelectorAll('input')).map(el => el.placeholder).filter(Boolean);
      });
      console.log('  사용 가능한 placeholders:', allPlaceholders);
    }

    // Step 3: 회의실 이름 필터 테스트
    console.log('\n[3] "회의실" 이름 필터 테스트...');
    const roomFilter = await page.$("input[placeholder='회의실 이름']");
    if (roomFilter) {
      // 먼저 현재 상태에서 스크롤로 더 많은 회의실 보기
      console.log('  현재 상태에서 가로 스크롤 테스트...');

      // 스크롤 가능한 컨테이너 찾기
      const scrollResult = await page.evaluate(() => {
        const doc = (globalThis).document;
        const scrollables = [];
        const allEls = Array.from(doc.querySelectorAll('div'));
        allEls.forEach(el => {
          if (el.scrollWidth > el.clientWidth + 10) {
            const rect = el.getBoundingClientRect();
            scrollables.push({
              className: (el.className || '').substring(0, 80),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              overflow: Math.round(el.scrollWidth - el.clientWidth),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            });
          }
        });
        return scrollables.filter(s => s.y > 150 && s.h > 200);
      });

      console.log(`  가로 스크롤 가능 요소: ${scrollResult.length}개`);
      for (const s of scrollResult) {
        console.log(`    class="${s.className}" overflow=${s.overflow}px @ (${s.x},${s.y}) ${s.w}x${s.h}`);
      }
    }

    // Step 4: 스크롤 방식으로 전체 회의실 수집
    console.log('\n[4] 가로 스크롤로 전체 회의실 수집...');

    // 타임그리드 영역에서 가로 스크롤 가능한 div 찾기
    const scrolled = await page.evaluate(() => {
      const doc = (globalThis).document;
      const allDivs = Array.from(doc.querySelectorAll('div'));
      for (const div of allDivs) {
        const rect = div.getBoundingClientRect();
        if (div.scrollWidth > div.clientWidth + 50 && rect.y > 150 && rect.h > 200) {
          // 끝까지 스크롤
          div.scrollLeft = div.scrollWidth;
          return {
            scrolled: true,
            scrollWidth: div.scrollWidth,
            scrollLeft: div.scrollLeft,
            className: (div.className || '').substring(0, 60),
          };
        }
      }
      return { scrolled: false };
    });

    console.log(`  스크롤 결과: ${JSON.stringify(scrolled)}`);
    await page.waitForTimeout(1500);

    // 스크롤 후 회의실 다시 파싱
    const headers2 = await getRoomHeaders(page);
    const rooms2 = parseRoomHeaders(headers2);
    console.log(`  스크롤 후 보이는 회의실: ${rooms2.length}개`);
    for (const r of rooms2) {
      console.log(`    ${r.building} ${r.floor}층 | ${r.name}`);
    }

    // 처음으로 되돌리고 점진적 스크롤
    console.log('\n[5] 점진적 스크롤로 전체 수집...');
    await page.evaluate(() => {
      const doc = (globalThis).document;
      const allDivs = Array.from(doc.querySelectorAll('div'));
      for (const div of allDivs) {
        if (div.scrollWidth > div.clientWidth + 50 && div.getBoundingClientRect().y > 150 && div.getBoundingClientRect().height > 200) {
          div.scrollLeft = 0;
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    const allRooms = new Map();
    const scrollStep = 400;
    let attempts = 0;

    while (attempts < 30) {
      const currentHeaders = await getRoomHeaders(page);
      const parsed = parseRoomHeaders(currentHeaders);
      let newFound = 0;
      for (const r of parsed) {
        const key = `${r.name}_${r.building}_${r.floor}`;
        if (!allRooms.has(key)) {
          allRooms.set(key, r);
          newFound++;
        }
      }

      const canScroll = await page.evaluate((step) => {
        const doc = (globalThis).document;
        const allDivs = Array.from(doc.querySelectorAll('div'));
        for (const div of allDivs) {
          if (div.scrollWidth > div.clientWidth + 50 && div.getBoundingClientRect().y > 150 && div.getBoundingClientRect().height > 200) {
            const before = div.scrollLeft;
            div.scrollLeft += step;
            return div.scrollLeft > before;
          }
        }
        return false;
      }, scrollStep);

      if (!canScroll) break;
      await page.waitForTimeout(300);
      attempts++;
    }

    const allRoomList = Array.from(allRooms.values()).sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));

    console.log(`\n총 발견: ${allRoomList.length}개 (${attempts} 스크롤)`);
    console.log('---');
    let prevFloor = 0;
    for (const r of allRoomList) {
      if (r.floor !== prevFloor) {
        console.log(`\n[${r.floor}층 - ${r.building}]`);
        prevFloor = r.floor;
      }
      console.log(`  ${r.name}`);
    }

    const bookable = allRoomList.filter(r => [2, 7, 8].includes(r.floor));
    console.log(`\n=== 예약 가능 (2, 7, 8층): ${bookable.length}개 ===`);
    for (const r of bookable) {
      console.log(`  ${r.floor}층 ${r.building} | ${r.name}`);
    }

    console.log('\n=== 완료 ===');

  } catch (err) {
    console.error('실패:', err.message);
    await page.screenshot({ path: 'logs/screenshots/test-filter-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

main();
