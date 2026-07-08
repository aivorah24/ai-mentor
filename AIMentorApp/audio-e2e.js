const { chromium } = require('playwright');

const BASE = 'http://localhost:3006';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Instrument window.Audio BEFORE any app code runs, so we can see every
  // Audio() constructed, and every play()/pause() call, with timestamps.
  await page.addInitScript(() => {
    window.__audioEvents = [];
    const OrigAudio = window.Audio;
    function PatchedAudio(...args) {
      const instance = args.length ? new OrigAudio(...args) : new OrigAudio();
      const id = Math.random().toString(36).slice(2, 8);
      window.__audioEvents.push({ id, type: 'created', src: args[0], t: Date.now() });
      const origPlay = instance.play.bind(instance);
      instance.play = (...a) => {
        window.__audioEvents.push({ id, type: 'play-called', t: Date.now() });
        return origPlay(...a).then(
          () => window.__audioEvents.push({ id, type: 'play-resolved', t: Date.now() }),
          (err) => window.__audioEvents.push({ id, type: 'play-rejected', err: String(err), t: Date.now() })
        );
      };
      const origPause = instance.pause.bind(instance);
      instance.pause = (...a) => {
        window.__audioEvents.push({ id, type: 'pause-called', t: Date.now() });
        return origPause(...a);
      };
      instance.addEventListener('play', () => window.__audioEvents.push({ id, type: 'DOM-play-event', t: Date.now() }));
      instance.addEventListener('pause', () => window.__audioEvents.push({ id, type: 'DOM-pause-event', t: Date.now() }));
      return instance;
    }
    PatchedAudio.prototype = OrigAudio.prototype;
    window.Audio = PatchedAudio;
  });

  const sceneAudioRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('/lesson/scene-audio')) {
      sceneAudioRequests.push({ url: req.url(), t: Date.now() });
    }
  });
  const sceneAudioResponses = [];
  page.on('response', async (res) => {
    if (res.url().includes('/lesson/scene-audio')) {
      sceneAudioResponses.push({ url: res.url(), status: res.status(), t: Date.now() });
    }
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console error]', msg.text());
  });
  page.on('pageerror', (err) => console.log('[page error]', err.message));

  console.log('--- Navigating to app as demo student (?demo=student) ---');
  await page.goto(BASE + '/?demo=student', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'audio-e2e-01-dashboard.png', fullPage: true });

  console.log('--- Opening My Learning Paths ---');
  await page.getByText('My Learning Paths', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'audio-e2e-02-learning-paths.png', fullPage: true });
  const lpText = await page.locator('body').innerText().catch(() => '');
  console.log('--- Learning Paths body text (first 1200 chars) ---');
  console.log(JSON.stringify(lpText.slice(0, 1200)));

  await browser.close();
})().catch((err) => {
  console.error('E2E script failed:', err);
  process.exit(1);
});
