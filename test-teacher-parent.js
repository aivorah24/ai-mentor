const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 600 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  let alertSeen = false;
  let alertMessage = '';

  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    alertSeen = true;
    console.log('✅ Alert appeared:', alertMessage.substring(0, 100));
    await dialog.dismiss();
  });

  console.log('1. Opening app...');
  await page.goto('http://localhost:8081');
  await page.waitForTimeout(3000);

  // Inject authError directly into React state by walking fibers
  console.log('2. Injecting TEACHER_ADD_PARENT authError into React state...');
  const dispatchResult = await page.evaluate(() => {
    function tryDispatch(fiber, depth) {
      if (!fiber || depth > 100) return false;
      // Look for useState hooks that hold string | null (authError)
      let state = fiber.memoizedState;
      while (state) {
        if (state.queue && state.queue.dispatch) {
          const val = state.memoizedState;
          // authError is string | null — dispatch the TEACHER_ADD_PARENT signal
          if (val === null) {
            try {
              state.queue.dispatch('TEACHER_ADD_PARENT:teacheraivorah@gmail.com');
              // Check if it took effect
              return 'dispatched-to-' + depth;
            } catch(e) {}
          }
        }
        state = state.next;
      }
      const fromChild = fiber.child ? tryDispatch(fiber.child, depth + 1) : false;
      if (fromChild) return fromChild;
      return fiber.sibling ? tryDispatch(fiber.sibling, depth + 1) : false;
    }

    // Find React root
    let rootEl = document.getElementById('root');
    if (!rootEl) rootEl = document.body.firstElementChild;
    const fKey = Object.keys(rootEl || {}).find(k => k.startsWith('__reactFiber'));
    if (!fKey) return 'no-fiber-key';
    return tryDispatch(rootEl[fKey], 0) || 'not-dispatched';
  });
  console.log('   Dispatch result:', dispatchResult);
  await page.waitForTimeout(2000);

  // Check raw error text visible anywhere
  const rawVisible = await page.evaluate(() => document.body.innerText.includes('TEACHER_ADD_PARENT:'));
  console.log('3. Raw TEACHER_ADD_PARENT text in UI:', rawVisible ? '❌ VISIBLE (bug)' : '✅ HIDDEN');

  // Take screenshot
  await page.screenshot({ path: 'test-result.png' });
  console.log('   Screenshot saved: test-result.png');

  await page.waitForTimeout(1000);
  await browser.close();

  console.log('\n=== TEST RESULTS ===');
  console.log('Alert fired:     ', alertSeen ? '✅ YES — "' + alertMessage.substring(0, 60) + '"' : '❌ NO');
  console.log('Raw error hidden:', !rawVisible ? '✅ YES' : '❌ NO');

  if (!alertSeen) {
    console.log('\nNote: React fiber walk may not have hit the right AuthContext state node.');
    console.log('The Alert.alert() on web uses window.alert which Playwright intercepts via page.on("dialog").');
    console.log('If dispatch succeeded but alert not seen, the useEffect may not have been triggered.');
  }
})().catch(e => console.error('Fatal:', e.message));
