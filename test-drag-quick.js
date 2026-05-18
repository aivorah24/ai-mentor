const { chromium } = require('playwright');
(async () => {
  // Connect to user's already-logged-in browser session
  // First, just inject a test into the already-open page
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  // Create a minimal test page that simulates the drag setup
  await page.setContent(`
    <div id="container" style="position:relative; width:300px; height:800px; background:#1a1a2e;">
      <div
        data-eid="test1"
        data-edate="2026-05-09"
        data-etop="168"
        data-edur="60"
        style="position:absolute; left:2px; right:2px; top:168px; height:56px;
               background:rgba(0,150,255,0.15); border-left:3px solid #0096ff;
               border-radius:4px; padding:5px; cursor:grab; user-select:none; z-index:2;"
      >
        <div style="color:white; font-size:11px; font-weight:700;">Test Event</div>
        <div style="color:rgba(255,255,255,0.8); font-size:10px;">10:00-11:00</div>
      </div>
    </div>
    <div id="log" style="color:white; background:#111; padding:10px; margin-top:10px; font-family:monospace;"></div>
    <script>
      const log = document.getElementById('log');
      function addLog(msg) { log.textContent += msg + '\\n'; console.log(msg); }

      // This is the EXACT same drag logic from TeacherScheduleScreen
      let drag = null;

      document.querySelector('[data-eid]').addEventListener('mousedown', function(e) {
        if (e.target.closest('[data-delbtn]')) return;
        e.preventDefault();
        const el = e.currentTarget;
        addLog('mousedown fired on ' + el.tagName + ' data-eid=' + el.getAttribute('data-eid'));
        addLog('e.currentTarget is HTMLElement: ' + (el instanceof HTMLElement));
        addLog('el.style.top = ' + el.style.top);
        drag = {
          eventId: el.getAttribute('data-eid'),
          dateISO: el.getAttribute('data-edate'),
          startY: e.clientY,
          origTop: parseFloat(el.getAttribute('data-etop')),
          duration: parseFloat(el.getAttribute('data-edur')),
          moved: false,
          el: el,
        };
        el.style.opacity = '0.85';
        el.style.zIndex = '999';
        el.style.cursor = 'grabbing';
        addLog('drag started, origTop=' + drag.origTop);
      });

      window.addEventListener('mousemove', function(e) {
        if (!drag) return;
        const delta = e.clientY - drag.startY;
        if (!drag.moved && Math.abs(delta) < 4) return;
        drag.moved = true;
        drag.el.style.top = Math.max(0, drag.origTop + delta) + 'px';
      });

      window.addEventListener('mouseup', function(e) {
        if (!drag) return;
        const d = drag;
        drag = null;
        d.el.style.opacity = '';
        d.el.style.zIndex = '';
        d.el.style.cursor = 'grab';
        if (!d.moved) return;
        const finalTop = d.el.style.top;
        addLog('mouseup: final top = ' + finalTop);
      });
    </script>
  `);

  await page.waitForTimeout(1000);

  // Now drag the element
  const el = page.locator('[data-eid="test1"]');
  const box = await el.boundingBox();
  const before = await el.evaluate(e => e.style.top);
  console.log('BEFORE:', before);

  const sx = box.x + box.width / 2;
  const sy = box.y + 10;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(100);
  for (let i = 0; i <= 112; i += 4) {
    await page.mouse.move(sx, sy + i);
    await page.waitForTimeout(10);
  }
  const during = await el.evaluate(e => e.style.top);
  console.log('DURING:', during);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await el.evaluate(e => e.style.top);
  console.log('AFTER:', after);

  const logText = await page.locator('#log').innerText();
  console.log('LOG:', logText);

  console.log(before !== after ? '\n✅ Native div drag WORKS: ' + before + ' -> ' + after : '\n❌ FAILED');

  await page.waitForTimeout(2000);
  await browser.close();
})();
