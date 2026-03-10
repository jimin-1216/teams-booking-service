/**
 * 건물 + 층 필터 조합으로 2, 7, 8층 회의실 전체 수집
 * 필터 드롭다운: css-y4bpjy 클래스
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

async function scrollAndCollectRooms(page) {
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

    for (const h of raw) {
      const match = h.location.match(/(별관|본관)\s*-?\s*(\d+)\s*층/);
      const key = `${h.name}_${h.location}`;
      if (!allRooms.has(key)) {
        allRooms.set(key, {
          name: h.name,
          building: match ? match[1] : '?',
          floor: match ? parseInt(match[2]) : 0,
          location: h.location,
        });
      }
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

  return Array.from(allRooms.values());
}

async function selectBuildingFilter(page, building) {
  // 회의실 위치 필터 클릭
  const locationFilter = await page.$("input[placeholder='회의실 위치']");
  await locationFilter.click();
  await page.waitForTimeout(800);

  // 건물 옵션 클릭 (css-y4bpjy 클래스)
  await page.locator(`div.css-y4bpjy:has-text("${building}")`).click();
  await page.waitForTimeout(1000);
}

async function selectFloorFilter(page, floor) {
  // 층 필터 클릭 — 건물 선택 후 바로 나오는 오른쪽 패널
  // 층 옵션 클릭
  try {
    await page.locator(`div:has-text("${floor}층")`).filter({ hasText: new RegExp(`^${floor}층$`) }).first().click({ timeout: 3000 });
  } catch {
    // 정확한 매칭 실패 시 텍스트 매칭
    await page.locator(`text=${floor}층`).first().click({ timeout: 3000 });
  }
  await page.waitForTimeout(1500);
}

async function main() {
  console.log('=== 건물+층 필터로 2, 7, 8층 회의실 수집 ===\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    await login(page);
    console.log('로그인 완료\n');

    const bookableFloors = [2, 7, 8];
    const allResults = [];

    // 본관 선택
    console.log('[건물 필터] "본관" 선택...');
    await selectBuildingFilter(page, '본관');

    // 층 드롭다운이 바로 보이는지 확인
    await page.screenshot({ path: 'logs/screenshots/test-filter-bonkwan.png', fullPage: true });

    for (const floor of bookableFloors) {
      console.log(`\n[층 필터] ${floor}층 선택...`);

      // 회의실 위치 필터 다시 열고 본관 → 층 선택
      await selectBuildingFilter(page, '본관');
      await page.waitForTimeout(500);

      // 층 선택
      try {
        await selectFloorFilter(page, floor);
        console.log(`  ${floor}층 필터 적용 완료`);
      } catch (err) {
        console.log(`  ${floor}층 필터 적용 실패: ${err.message.substring(0, 60)}`);

        // 드롭다운 닫기 (다른곳 클릭)
        await page.click('body', { position: { x: 100, y: 500 } });
        await page.waitForTimeout(500);
        continue;
      }

      await page.screenshot({ path: `logs/screenshots/test-filter-floor${floor}.png`, fullPage: true });

      // 타임그리드에서 회의실 수집 (스크롤 포함)
      const rooms = await scrollAndCollectRooms(page);
      console.log(`  ${floor}층 회의실: ${rooms.length}개`);
      for (const r of rooms) {
        console.log(`    ${r.building} ${r.floor}층 | ${r.name}`);
      }
      allResults.push(...rooms);

      // 필터 리셋: 다른곳 클릭
      await page.click('body', { position: { x: 100, y: 500 } });
      await page.waitForTimeout(500);
    }

    // 별관도 확인 (2, 7, 8층에 별관 회의실이 있을 수 있음)
    console.log('\n\n[건물 필터] "별관" 확인...');
    await selectBuildingFilter(page, '별관');
    await page.screenshot({ path: 'logs/screenshots/test-filter-byulgwan.png', fullPage: true });

    // 별관의 층 옵션 확인
    const byulgwanOptions = await page.evaluate(() => {
      const doc = (globalThis).document;
      const results = [];
      doc.querySelectorAll('div').forEach(el => {
        const text = el.textContent?.trim();
        const rect = el.getBoundingClientRect();
        if (text && /^\d층$/.test(text) && rect.x > 500 && rect.y > 200 && rect.y < 500) {
          results.push(text);
        }
      });
      return results;
    });
    console.log(`  별관 층 옵션: ${byulgwanOptions.join(', ')}`);

    // 드롭다운 닫기
    await page.click('body', { position: { x: 100, y: 500 } });
    await page.waitForTimeout(500);

    // === 최종 결과 ===
    console.log('\n\n=== 최종 결과: 예약 가능 회의실 (2, 7, 8층) ===');
    const unique = new Map();
    for (const r of allResults) {
      const key = `${r.name}_${r.building}_${r.floor}`;
      if (!unique.has(key)) unique.set(key, r);
    }
    const finalList = Array.from(unique.values()).sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));
    for (const r of finalList) {
      console.log(`  ${r.floor}층 ${r.building} | ${r.name}`);
    }
    console.log(`총 ${finalList.length}개`);

    console.log('\n=== 완료 ===');

  } catch (err) {
    console.error('실패:', err.message);
    await page.screenshot({ path: 'logs/screenshots/test-filter-floors-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

main();
