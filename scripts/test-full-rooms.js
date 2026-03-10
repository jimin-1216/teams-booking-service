/**
 * 전체 회의실 목록 스크래핑 (가로 스크롤 + 드롭다운)
 * 두 가지 방식으로 수집하여 비교:
 * 1) 예약 폼의 회의실 검색 드롭다운
 * 2) 타임그리드 가로 스크롤
 */
const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.MILE_USERNAME;
const PASSWORD = process.env.MILE_PASSWORD;

async function main() {
  console.log('=== 전체 회의실 목록 수집 ===\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    // 로그인 + 워크스페이스 선택
    console.log('[로그인 중...]');
    await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.fill("input[placeholder='이메일 주소']", EMAIL);
    await page.fill("input[type='password'][placeholder='비밀번호']", PASSWORD);
    await page.waitForTimeout(500);
    await page.click('button.button-solid-primary:not(.button-solid-disabled)');
    await page.waitForURL('**/workspace/**', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.locator(':has-text("서울창업허브")').first().click();
    await page.waitForTimeout(3000);
    console.log('로그인 완료!\n');

    // === 방법 1: 예약 폼 드롭다운에서 전체 목록 ===
    console.log('[방법 1] 예약 폼 드롭다운에서 회의실 목록...');

    // 예약하기 버튼 클릭
    await page.click('button:has-text("예약하기")');
    await page.waitForTimeout(2000);

    // 회의실 검색 필드 클릭 (빈 상태로 전체 목록 보기)
    const roomSearch = await page.$("input[placeholder='회의실 선택 (건물명, 회의실명 검색)']");
    if (roomSearch) {
      await roomSearch.click();
      await page.waitForTimeout(1500);

      // 드롭다운 스크린샷
      await page.screenshot({ path: 'logs/screenshots/test-room-dropdown-all.png', fullPage: true });

      // 드롭다운 내 항목 파싱
      const dropdownRooms = await page.evaluate(() => {
        const doc = (globalThis).document;
        const results = [];

        // 드롭다운 내 모든 텍스트 요소 수집
        // 검색 결과 영역의 모든 요소를 찾기
        const allText = [];
        const elements = doc.querySelectorAll('[class*="option"], [class*="item"], [class*="list"] > div, [class*="dropdown"] div, [class*="select"] div, [class*="menu"] div');

        elements.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.includes('층') && text.length < 100) {
            allText.push({ text, className: el.className, tagName: el.tagName });
          }
        });

        return allText;
      });

      console.log(`  드롭다운 요소: ${dropdownRooms.length}개`);
      for (const r of dropdownRooms.slice(0, 20)) {
        console.log(`    ${r.text.replace(/\n/g, ' | ')} [${r.tagName}.${r.className?.substring(0, 30)}]`);
      }
    }

    // 검색어로 건물별 조회
    console.log('\n  건물별 검색 테스트:');
    for (const keyword of ['본관', '별관', '7층', '8층', '2층']) {
      if (roomSearch) {
        await roomSearch.fill('');
        await page.waitForTimeout(300);
        await roomSearch.fill(keyword);
        await page.waitForTimeout(1500);

        const count = await page.evaluate(() => {
          const doc = (globalThis).document;
          const items = doc.querySelectorAll('[class*="option"], [class*="item"], [class*="list"] > div');
          let count = 0;
          items.forEach(el => {
            if (el.textContent?.includes('층') && el.textContent.length < 200) count++;
          });
          return count;
        });

        // 검색 결과의 실제 텍스트
        const texts = await page.evaluate(() => {
          const doc = (globalThis).document;
          const items = doc.querySelectorAll('[class*="option"], [class*="item"], [class*="list"] > div');
          const results = [];
          items.forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.includes('층') && text.length < 200 && !results.includes(text)) {
              results.push(text.replace(/\n/g, ' '));
            }
          });
          return results;
        });

        console.log(`    "${keyword}" → ${texts.length}개`);
        for (const t of texts.slice(0, 10)) {
          console.log(`      ${t}`);
        }
      }
    }

    // 패널 닫기
    const closeBtn = await page.$('button:has(svg), [class*="close"]');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(500);

    // === 방법 2: 타임그리드 가로 스크롤 ===
    console.log('\n[방법 2] 타임그리드 가로 스크롤...');

    // ">>" 버튼으로 끝까지 스크롤하면서 회의실 수집
    const allRooms = new Map();
    let scrollAttempts = 0;
    const maxScrolls = 20;

    while (scrollAttempts < maxScrolls) {
      // 현재 보이는 회의실 파싱
      const currentHeaders = await page.evaluate(() => {
        const results = [];
        const doc = (globalThis).document;
        const allEls = Array.from(doc.querySelectorAll('*'));
        const detailEls = allEls.filter(
          el => el.textContent?.trim() === '상세 정보' && el.children.length === 0
        );
        detailEls.forEach(el => {
          const parent = el.closest?.('div')?.parentElement;
          if (!parent) return;
          const texts = parent.innerText.split('\n').map(t => t.trim()).filter(Boolean);
          if (texts.length >= 2) {
            results.push({
              name: texts[0],
              location: texts.find(t => t.includes('층') && t.includes('-')) || texts[1],
            });
          }
        });
        return results;
      });

      let newFound = 0;
      for (const h of currentHeaders) {
        const key = `${h.name}_${h.location}`;
        if (!allRooms.has(key)) {
          allRooms.set(key, h);
          newFound++;
        }
      }

      if (newFound === 0 && scrollAttempts > 0) {
        // 새 회의실이 없으면 끝
        break;
      }

      // ">" 버튼 클릭 (다음 회의실 그룹)
      const nextBtn = await page.$('button[class*="next"], svg[class*="next"]');
      // 또는 ">" 화살표 찾기
      const arrowBtns = await page.$$('button');
      let clicked = false;
      for (const btn of arrowBtns) {
        const text = await btn.textContent();
        const ariaLabel = await btn.getAttribute('aria-label');
        if (text?.trim() === '>' || text?.trim() === '›' || ariaLabel?.includes('next')) {
          await btn.click();
          await page.waitForTimeout(800);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        // ">" 모양의 SVG 아이콘 버튼 시도 - 오른쪽 화살표
        const svgBtns = await page.$$('button:has(svg)');
        for (const btn of svgBtns) {
          const box = await btn.boundingBox();
          // 타임그리드 헤더 영역의 오른쪽에 있는 버튼
          if (box && box.x > 1000 && box.y > 200 && box.y < 300) {
            await btn.click();
            await page.waitForTimeout(800);
            clicked = true;
            break;
          }
        }
      }

      if (!clicked) {
        console.log('  스크롤 버튼을 찾을 수 없음, 중단');
        break;
      }

      scrollAttempts++;
    }

    console.log(`  스크롤 횟수: ${scrollAttempts}`);
    console.log(`  총 발견 회의실: ${allRooms.size}개\n`);

    // 결과 정리
    const roomList = [];
    for (const [key, h] of allRooms) {
      const match = h.location.match(/(별관|본관)\s*-?\s*(\d+)\s*층/);
      roomList.push({
        name: h.name,
        building: match ? match[1] : '?',
        floor: match ? parseInt(match[2]) : 0,
        location: h.location,
      });
    }

    // 층별 정렬
    roomList.sort((a, b) => a.floor - b.floor || a.building.localeCompare(b.building) || a.name.localeCompare(b.name));

    console.log('  전체 회의실 목록:');
    console.log('  ---');
    let prevFloor = 0;
    for (const r of roomList) {
      if (r.floor !== prevFloor) {
        console.log(`\n  [${r.floor}층]`);
        prevFloor = r.floor;
      }
      console.log(`    ${r.building} | ${r.name}`);
    }

    // 2, 7, 8층만 필터
    console.log('\n\n  === 예약 가능 (2, 7, 8층) ===');
    const bookable = roomList.filter(r => [2, 7, 8].includes(r.floor));
    for (const r of bookable) {
      console.log(`    ${r.floor}층 ${r.building} | ${r.name}`);
    }
    console.log(`  총 ${bookable.length}개`);

    console.log('\n=== 완료 ===');

  } catch (err) {
    console.error('\n❌ 실패:', err.message);
    await page.screenshot({ path: 'logs/screenshots/test-rooms-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

main();
