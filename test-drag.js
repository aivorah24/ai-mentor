const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('1. Opening app...');
  await page.goto('http://localhost:3006');
  await page.waitForLoadState('networkidle');

  // Click Login button on landing page
  const loginBtn = page.locator('text=Login').first();
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('2a. Clicking Login...');
    await loginBtn.click();
    await page.waitForTimeout(1500);
  }

  // Fill credentials
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('2b. Filling credentials...');
    await emailInput.fill('teacher@demo.com');
    await page.locator('input[type="password"]').first().fill('password123');
    // Submit via JS
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return; }
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const primary = btns.find(b => {
        const style = window.getComputedStyle(b);
        return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && b.offsetParent !== null;
      });
      if (primary) primary.click();
    });
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: 'drag-after-login.png' });
  console.log('   Saved drag-after-login.png');

  // Find Schedule nav link — look for one at left side of screen (sidebar)
  console.log('3. Finding Schedule nav link...');
  const allSchedule = page.locator('text=Schedule');
  const cnt = await allSchedule.count();
  console.log(`   Found ${cnt} "Schedule" text elements`);

  let navigated = false;
  for (let i = 0; i < cnt; i++) {
    const rect = await allSchedule.nth(i).boundingBox();
    const text = await allSchedule.nth(i).innerText().catch(() => '');
    console.log(`   [${i}] x:${rect ? rect.x.toFixed(0) : '?'} y:${rect ? rect.y.toFixed(0) : '?'} text:"${text.trim()}"`);
    if (rect && rect.x < 300 && text.trim() === 'Schedule') {
      await allSchedule.nth(i).click({ force: true });
      navigated = true;
      console.log('   Clicked sidebar Schedule');
      break;
    }
  }

  if (!navigated) {
    // Try clicking any Schedule link
    if (cnt > 0) {
      await allSchedule.first().click({ force: true });
      navigated = true;
    }
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'drag-schedule.png' });
  console.log('   Saved drag-schedule.png');

  // Find draggable event blocks
  console.log('4. Looking for draggable events...');
  const events = page.locator('[style*="grab"]');
  const count = await events.count();
  console.log(`   Found ${count} elements with cursor:grab`);

  for (let i = 0; i < Math.min(count, 8); i++) {
    const text = await events.nth(i).innerText().catch(() => '');
    const top = await events.nth(i).evaluate(el => el.style.top);
    const cursor = await events.nth(i).evaluate(el => el.style.cursor);
    console.log(`   [${i}] top:${top} cursor:${cursor} text:"${text.replace(/\n/g, ' ').slice(0, 40)}"`);
  }

  // Pick first event with actual text content
  let eventIndex = -1;
  let box = null;
  for (let i = 0; i < count; i++) {
    const text = await events.nth(i).innerText().catch(() => '');
    const b = await events.nth(i).boundingBox();
    if (text.trim() && b) { eventIndex = i; box = b; break; }
  }

  if (eventIndex < 0 || !box) {
    console.log('   No event with text found — cannot test drag');
    await browser.close();
    return;
  }

  const event = events.nth(eventIndex);
  const initialTop = await event.evaluate(el => el.style.top);
  console.log(`5. Using event [${eventIndex}] initial top: ${initialTop}`);

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const dragPx = 112;

  console.log(`6. Dragging from (${startX.toFixed(0)}, ${startY.toFixed(0)}) down ${dragPx}px...`);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(150);

  for (let i = 4; i <= dragPx; i += 4) {
    await page.mouse.move(startX, startY + i);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);

  const midTop = await event.evaluate(el => el.style.top);
  console.log('7. Top DURING drag:', midTop);

  await page.mouse.up();
  await page.waitForTimeout(800);

  const finalTop = await event.evaluate(el => el.style.top);
  console.log('8. Top AFTER drop:', finalTop);

  if (initialTop !== finalTop) {
    console.log('\n✅ DRAG WORKS! Moved:', initialTop, '→', finalTop);
  } else {
    console.log('\n❌ NOT WORKING — top unchanged');
    const canSet = await event.evaluate(el => {
      el.style.top = '999px';
      return el.style.top;
    });
    console.log('   Direct style.top settable?', canSet === '999px' ? 'YES' : 'NO → ' + canSet);

    const fired = await event.evaluate(el => {
      return new Promise(res => {
        let f = false;
        el.addEventListener('mousedown', () => { f = true; }, { once: true, capture: true });
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 }));
        setTimeout(() => res(f ? 'fired ✓' : 'NOT fired ✗'), 200);
      });
    });
    console.log('   mousedown event:', fired);
  }

  await page.screenshot({ path: 'drag-test-result.png' });
  console.log('9. Saved drag-test-result.png');
  await page.waitForTimeout(1500);
  await browser.close();
})();
