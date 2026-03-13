/**
 * 날짜 네비 > 버튼 정확히 찾아서 클릭 + 시간 input React fiber 수정
 */
const { chromium } = require('playwright');
require('dotenv').config();

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(15000);

  // 로그인 → 워크스페이스
  await page.goto('https://app.mile.im/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill("input[placeholder='이메일 주소']", process.env.MILE_USERNAME);
  await page.fill("input[type='password'][placeholder='비밀번호']", process.env.MILE_PASSWORD);
  await page.waitForTimeout(500);
  await page.click('button.button-solid-primary:not(.button-solid-disabled)');
  await page.waitForURL('**/workspace/**', { timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.locator(':has-text("서울창업허브")').first().click();
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // 1. 날짜 네비 > 버튼 분석 (< 와 > 사이에 날짜 텍스트 버튼)
  console.log('\n=== 상단 영역 모든 버튼 (y=80~130) ===\n');
  const topBtns = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('button, [role="button"]').forEach((btn, i) => {
      const rect = btn.getBoundingClientRect();
      if (rect.y > 75 && rect.y < 135 && rect.width > 0) {
        results.push({
          i, text: btn.textContent?.trim()?.substring(0, 30),
          class: btn.className?.substring(0, 50),
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height),
          hasSvg: !!btn.querySelector('svg'),
        });
      }
    });
    return results;
  });
  for (const b of topBtns) {
    console.log(`  [${b.i}] x=${b.x} w=${b.w} text="${b.text}" svg=${b.hasSvg} class="${b.class}"`);
  }

  // > 버튼 = 날짜 텍스트 오른쪽의 SVG 버튼
  console.log('\n=== > 버튼 클릭 ===\n');
  const dateTextBtn = topBtns.find(b => b.text?.includes('2026'));
  const nextBtnCandidates = topBtns.filter(b => b.hasSvg && b.x > (dateTextBtn?.x || 500));
  console.log('  날짜 버튼:', dateTextBtn);
  console.log('  > 후보:', nextBtnCandidates);

  if (nextBtnCandidates.length > 0) {
    const nextBtn = nextBtnCandidates[0]; // 날짜 오른쪽 첫 번째 SVG 버튼
    console.log(`  > 버튼 클릭: x=${nextBtn.x}, y=${nextBtn.y}`);
    await page.mouse.click(nextBtn.x + nextBtn.w / 2, nextBtn.y + nextBtn.h / 2);
    await page.waitForTimeout(2000);

    const newDate = await page.evaluate(() => {
      const btn = document.querySelector('button.button-text.secondary.enabled.medium');
      return btn?.textContent?.trim();
    });
    console.log('  변경 후 날짜:', newDate);
  }

  // 2. 예약하기 열고 시간 변경 테스트
  console.log('\n=== 예약 폼 시간 변경 ===\n');
  await page.click('button.button-solid-primary:has-text("예약하기")');
  await page.waitForTimeout(1500);

  // 폼 상태
  const formState = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input.input'));
    return inputs
      .filter(el => el.getBoundingClientRect().x > 830)
      .map(el => ({ value: el.value, x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y) }));
  });
  console.log('  폼 inputs:', formState);

  // 시간 input의 React fiber에서 onChange 핸들러를 찾아 호출
  const timeChangeResult = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input.input'));
    const timeInput = inputs.find(el => {
      const r = el.getBoundingClientRect();
      return r.x > 830 && el.value.match(/^\d{1,2}:\d{2}$/);
    });
    if (!timeInput) return 'no input';

    // React props에서 onChange 찾기
    const propsKey = Object.keys(timeInput).find(k => k.startsWith('__reactProps'));
    if (!propsKey) return 'no props key';

    const props = timeInput[propsKey];
    const result = {
      currentValue: timeInput.value,
      propsKeys: Object.keys(props),
      hasOnChange: typeof props.onChange === 'function',
      hasOnBlur: typeof props.onBlur === 'function',
      hasOnInput: typeof props.onInput === 'function',
    };

    // React onChange를 synthetic event처럼 호출
    if (props.onChange) {
      // React SyntheticEvent 흉내
      const fakeEvent = {
        target: { value: '18:00' },
        currentTarget: { value: '18:00' },
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new Event('change'),
        type: 'change',
      };
      try {
        props.onChange(fakeEvent);
        result.afterOnChange = timeInput.value;
      } catch(e) {
        result.changeError = e.message;
      }
    }

    return result;
  });
  console.log('  onChange 결과:', timeChangeResult);

  // 최종 시간 확인
  await page.waitForTimeout(500);
  const finalTime = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input.input'));
    return inputs
      .filter(el => el.getBoundingClientRect().x > 830 && el.value.match(/^\d{1,2}:\d{2}$/))
      .map(el => el.value);
  });
  console.log('  최종 시간:', finalTime);

  await page.screenshot({ path: 'logs/screenshots/test-after-time-change.png', fullPage: true });

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(console.error);
