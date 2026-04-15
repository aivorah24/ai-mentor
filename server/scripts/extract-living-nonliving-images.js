const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, '../../canva_living_nonliving.html');
const OUT_DIR = path.join(__dirname, '../data/images/living_nonliving');
const WIDTH = 1280;
const HEIGHT = 720;

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  const fileUrl = 'file:///' + HTML_FILE.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 5000)); // wait for Canva to load

  // Detection: How many slides?
  const slideCount = 12; // Based on our manifest

  for (let i = 0; i < slideCount; i++) {
    console.log(`Capturing slide ${i + 1}/${slideCount}...`);
    const imgPath = path.join(OUT_DIR, `slide_${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: imgPath });
    
    if (i < slideCount - 1) {
      await page.keyboard.press('ArrowRight');
      await new Promise(r => setTimeout(r, 1000)); // wait for transition
    }
  }

  await browser.close();
  console.log('Done capturing slides!');
})();
