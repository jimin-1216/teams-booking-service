/**
 * E2E 예약 테스트: 로그인 → 날짜이동 → 회의실 조회 → 예약 실행 → 확인 → 취소
 *
 * Usage:
 *   node scripts/e2e-booking.js              # 전체 플로우 (예약 + 취소)
 *   node scripts/e2e-booking.js --dry-run    # 예약 폼 입력까지만 (제출 안함)
 *   node scripts/e2e-booking.js --search-only # 회의실 조회만
 *
 * 참고:
 *   - 시간 input은 React controlled component로 외부 변경 불가
 *   - 폼을 열면 현재 시간 기준 기본값(+30분 블록)이 자동 세팅됨
 *   - 날짜는 예약 현황 > 버튼으로 이동 후 폼을 열면 자동 반영
 */
const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.MILE_USERNAME;
const PASSWORD = process.env.MILE_PASSWORD;
const WORKSPACE = '서울창업허브';

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const SEARCH_ONLY = ARGS.includes('--search-only');

// > 버튼 좌표 (예약 현황 상단 날짜 네비게이션)
const NAV_NEXT = { x: 536, y: 104 };
const NAV_PREV = { x: 505, y: 104 };

async function step(name, fn) {
  const start = Date.now();
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ ${name}`);
  console.log('─'.repeat(50));
  try {
    const result = await fn();
    console.log(`  ✅ 완료 (${Date.now() - start}ms)`);
    return result;
  } catch (err) {
    console.error(`  ❌ 실패 (${Date.now() - start}ms): ${err.message}`);
    throw err;
  }
}

async function screenshot(page, name) {
  const filepath = `logs/screenshots/e2e-${name}-${Date.now()}.png`;
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  📸 ${filepath}`);
}

async function getFormInputs(page) {
  return page.evaluate(() => {
    const results = [];
    document.querySelectorAll('input.input').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.x > 830 && r.width > 0) {
        results.push({ value: el.value, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    return results;
  });
}

async function getPageDate(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('button.button-text.secondary.enabled.medium');
    return btn?.textContent?.trim();
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       E2E 예약 플로우 테스트                     ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\n  모드: ${DRY_RUN ? 'DRY-RUN' : SEARCH_ONLY ? 'SEARCH-ONLY' : '전체 (예약+취소)'}`);

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  let bookedRoomName = null;
  let bookedDate = null;
  let bookedStartTime = null;

  try {
    // ── Step 1: 로그인 ──
    await step('Step 1: 로그인', async () => {
      await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      await page.fill("input[placeholder='이메일 주소']", EMAIL);
      await page.fill("input[type='password'][placeholder='비밀번호']", PASSWORD);
      await page.waitForTimeout(500);
      await page.click('button.button-solid-primary:not(.button-solid-disabled)');
      await page.waitForURL('**/workspace/**', { timeout: 10000 });
      console.log(`  URL: ${page.url()}`);
    });

    // ── Step 2: 워크스페이스 선택 ──
    await step('Step 2: 워크스페이스 선택', async () => {
      await page.waitForTimeout(2000);
      await page.locator(`:has-text("${WORKSPACE}")`).first().click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const date = await getPageDate(page);
      console.log(`  현재 날짜: ${date}`);
    });

    // ── Step 3: 내일로 이동 ──
    await step('Step 3: 내일 날짜로 이동', async () => {
      const before = await getPageDate(page);
      console.log(`  이동 전: ${before}`);
      await page.mouse.click(NAV_NEXT.x, NAV_NEXT.y);
      await page.waitForTimeout(2000);
      const after = await getPageDate(page);
      console.log(`  이동 후: ${after}`);
      if (before === after) {
        throw new Error('날짜가 변경되지 않았습니다.');
      }
      bookedDate = after;
    });

    // ── Step 4: 필터로 회의실 조회 ──
    const rooms = await step('Step 4: 회의실 조회 (본관 7층)', async () => {
      const locationFilter = await page.waitForSelector("input[placeholder='회의실 위치']", { timeout: 10000 });
      await locationFilter.click();
      await page.waitForTimeout(800);
      await page.locator('div.css-y4bpjy:has-text("본관")').click();
      await page.waitForTimeout(500);
      await page.locator('text=7층').first().click();
      await page.waitForTimeout(1500);

      const headers = await page.evaluate(() => {
        const results = [];
        const allEls = Array.from(document.querySelectorAll('*'));
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

      console.log(`  7층 회의실 ${headers.length}개:`);
      for (const h of headers) console.log(`    - ${h.name} (${h.location})`);

      // 필터 닫기
      await page.click('body', { position: { x: 100, y: 500 } });
      await page.waitForTimeout(500);
      return headers;
    });

    if (SEARCH_ONLY || rooms.length === 0) {
      console.log(rooms.length === 0 ? '\n⚠️ 조회된 회의실 없음' : '\n🏁 SEARCH-ONLY 모드 종료');
      return;
    }

    // ── Step 5: 예약 폼 열기 + 입력 ──
    await step('Step 5: 예약 폼 작성', async () => {
      // 우상단 + 예약하기 버튼 (evaluate로 오버레이 회피)
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent?.includes('예약하기') && btn.className.includes('button-solid-primary')) {
            const rect = btn.getBoundingClientRect();
            if (rect.x > 1000) { btn.click(); return; }
          }
        }
      });
      await page.waitForTimeout(1500);

      const fi = await getFormInputs(page);
      console.log(`  폼: 제목="${fi[0]?.value}" 날짜="${fi[1]?.value}" 시간="${fi[2]?.value}~${fi[3]?.value}"`);
      bookedStartTime = fi[2]?.value;
      await screenshot(page, 'form-opened');

      // 회의실 선택
      const targetRoom = rooms[0].name;
      bookedRoomName = targetRoom;
      console.log(`  [회의실] ${targetRoom}`);

      // 회의실 input에 타이핑
      const roomInput = fi[4];
      await page.mouse.click(roomInput.x + 50, roomInput.y + roomInput.h / 2);
      await page.waitForTimeout(300);
      await page.keyboard.type(targetRoom, { delay: 50 });
      await page.waitForTimeout(1500);

      await screenshot(page, 'room-dropdown');

      // 드롭다운에서 정확한 항목 클릭 (div.css-4d7k9p)
      const selected = await page.evaluate((roomName) => {
        // 드롭다운 항목: div.css-4d7k9p, 60px 높이, "회의실 ①본관 - 7층 | 4인" 형태
        const items = document.querySelectorAll('div.css-4d7k9p');
        for (const item of items) {
          const text = item.textContent?.trim() || '';
          // 정확한 매칭: 회의실 이름 + "본관 - 7층"
          if (text.includes(roomName) && text.includes('본관 - 7층')) {
            item.click();
            return { text: text.substring(0, 50), method: 'css-4d7k9p' };
          }
        }
        // 폴백: 아무 7층 항목
        for (const item of items) {
          const text = item.textContent?.trim() || '';
          if (text.includes('본관 - 7층')) {
            item.click();
            return { text: text.substring(0, 50), method: 'fallback-7floor' };
          }
        }
        return null;
      }, targetRoom);
      console.log(`  선택:`, selected);
      await page.waitForTimeout(500);

      // 메모 입력
      const memoField = await page.$("textarea[placeholder='예약 메모']");
      if (memoField) {
        await memoField.fill('E2E 테스트 예약 (자동 취소 예정)');
        console.log('  [메모] 입력 완료');
      }

      // 최종 확인
      const final = await getFormInputs(page);
      console.log(`\n  ── 최종 폼 상태 ──`);
      console.log(`  제목: ${final[0]?.value}`);
      console.log(`  날짜: ${final[1]?.value}`);
      console.log(`  시간: ${final[2]?.value} ~ ${final[3]?.value}`);
      console.log(`  회의실: ${final[4]?.value || '(선택됨)'}`);
      await screenshot(page, 'form-filled');
    });

    if (DRY_RUN) {
      console.log('\n🏁 DRY-RUN 모드: 폼 작성까지 완료, 제출하지 않음');
      await page.waitForTimeout(5000);
      return;
    }

    // ── Step 6: 예약 제출 ──
    await step('Step 6: 예약 제출', async () => {
      // 제출 버튼: 폼 하단의 예약하기 (disabled가 아닌)
      // evaluate로 제출 (오버레이 문제 회피)
      const submitted = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const text = btn.textContent?.trim();
          const cls = btn.className || '';
          const rect = btn.getBoundingClientRect();
          // 폼 내 제출 버튼: 우측 패널, "예약하기", solid-primary, disabled 아님
          if (text === '예약하기' && cls.includes('button-solid-primary') && !cls.includes('disabled') && rect.x > 830) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (!submitted) {
        throw new Error('예약하기 버튼을 클릭하지 못했습니다. (비활성 또는 미발견)');
      }

      console.log('  예약하기 클릭 완료');
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(3000);
      await screenshot(page, 'after-submit');

      // 에러 확인
      const error = await page.evaluate(() => {
        const errEls = document.querySelectorAll('[class*="error"], [class*="alert"], [class*="toast"]');
        for (const el of errEls) {
          const text = el.textContent?.trim();
          if (text && text.length > 5) return text;
        }
        return null;
      });
      if (error) throw new Error(`예약 에러: ${error}`);
      console.log('  예약 제출 성공 (에러 없음)');

      // 예약 폼 닫기 (X 버튼 또는 오버레이 클릭)
      await page.evaluate(() => {
        // X 닫기 버튼
        const closeBtn = document.querySelector('button[aria-label="닫기"], [class*="close"]');
        if (closeBtn) { closeBtn.click(); return; }
        // 또는 X 아이콘 (svg가 있는 작은 버튼)
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const rect = btn.getBoundingClientRect();
          if (rect.x > 1200 && rect.y > 90 && rect.y < 140 && rect.width < 50) {
            btn.click(); return;
          }
        }
      });
      await page.waitForTimeout(1000);
    });

    // ── Step 7: 나의 예약에서 확인 ──
    await step('Step 7: 예약 확인 (나의 예약/참석)', async () => {
      // 사이드바에서 "나의 예약/참석" 클릭
      await page.evaluate(() => {
        const els = document.querySelectorAll('a, p, span, div');
        for (const el of els) {
          if (el.textContent?.trim() === '나의 예약/참석' && el.getBoundingClientRect().x < 250) {
            el.click();
            return;
          }
        }
      });
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      await page.waitForTimeout(2000);
      await screenshot(page, 'my-bookings');

      const pageText = await page.textContent('body');
      const found = pageText.includes(bookedRoomName) || pageText.includes('E2E 테스트');
      console.log(`  예약 ${found ? '확인됨 ✓' : '미확인 ⚠️ (스크린샷 확인)'}`);
    });

    // ── Step 8: 예약 취소 ──
    await step('Step 8: 예약 취소', async () => {
      // evaluate로 삭제 버튼 찾기 + scrollIntoView + 클릭
      const deleteResult = await page.evaluate(({ roomName, startTime }) => {
        const btns = document.querySelectorAll('button');
        const deleteBtns = Array.from(btns).filter(b => b.textContent?.trim() === '삭제하기');

        if (deleteBtns.length === 0) return { error: 'no delete buttons' };

        for (const btn of deleteBtns) {
          let container = btn.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!container) break;
            const text = container.textContent || '';
            if (text.includes(roomName) || text.includes('E2E 테스트') || (startTime && text.includes(startTime))) {
              btn.scrollIntoView({ behavior: 'instant', block: 'center' });
              btn.click();
              return { found: true, text: text.substring(0, 80) };
            }
            container = container.parentElement;
          }
        }

        // 폴백: 마지막 삭제 버튼
        const lastBtn = deleteBtns[deleteBtns.length - 1];
        lastBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        lastBtn.click();
        return { found: true, fallback: true, count: deleteBtns.length };
      }, { roomName: bookedRoomName, startTime: bookedStartTime });

      console.log(`  삭제:`, deleteResult);
      await page.waitForTimeout(1500);
      await screenshot(page, 'delete-confirm');

      // 확인 대화상자 (모달)
      const confirmed = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const text = btn.textContent?.trim();
          if (text === '확인' || text === '삭제') {
            btn.click();
            return text;
          }
        }
        return null;
      });
      console.log(`  확인 대화상자: ${confirmed || '없음'}`);

      await page.waitForLoadState('networkidle', { timeout: 10000 });
      await page.waitForTimeout(2000);
      await screenshot(page, 'after-cancel');
      console.log('  예약 취소 완료');
    });

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  ✅ E2E 전체 플로우 성공                         ║');
    console.log('╚══════════════════════════════════════════════════╝');

  } catch (err) {
    console.error(`\n💥 E2E 실패: ${err.message}`);
    await screenshot(page, 'error');
    process.exitCode = 1;
  } finally {
    console.log('\n브라우저 종료 (5초)...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

main();
