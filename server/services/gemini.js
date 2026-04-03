/**
 * services/gemini.js
 * Google Gemini — scene image generation for lesson slides
 * Model: gemini-2.0-flash-exp (supports image generation via responseModalities)
 *
 * Setup: Add to server/.env: GEMINI_API_KEY=your_key_here
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const GENERATED_DIR = path.join(__dirname, '../data/images/generated');
try { fs.mkdirSync(GENERATED_DIR, { recursive: true }); } catch (_) { /* read-only fs on Vercel, skip */ }

// gemini-2.5-flash-image supports IMAGE responseModality
const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_API   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Generate a cartoon-style educational illustration for a lesson scene.
 * Saves to /data/images/scenes/ch<N>/scene_<NN>.png (fixed path per scene).
 * Caches to disk — only calls Gemini API once per unique scene.
 *
 * @param {object} opts
 * @param {string} opts.prompt     - Full image prompt describing the scene
 * @param {string} opts.savePath   - Absolute disk path to save the PNG
 * @param {string} opts.servePath  - URL path returned to caller (e.g. /data/images/scenes/ch3/scene_02.png)
 * @returns {string|null}          - servePath on success, null on failure
 */
async function generateImage({ prompt, savePath, servePath }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  if (fs.existsSync(savePath)) {
    console.log(`  SKIP (exists): ${path.basename(savePath)}`);
    return servePath;
  }

  try {
    const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  Gemini error (${res.status}):`, err.slice(0, 200));
      return null;
    }

    const data    = await res.json();
    const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!imgPart?.inlineData?.data) {
      console.error('  Gemini: no image in response');
      return null;
    }

    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, Buffer.from(imgPart.inlineData.data, 'base64'));
    console.log(`  OK: ${path.basename(savePath)}`);
    return servePath;
  } catch (err) {
    console.error(`  Gemini generateImage error: ${err.message}`);
    return null;
  }
}

// Legacy wrapper used by lesson.js (kept for compatibility)
async function generateSceneImage(sceneText, topic, visual = '') {
  const cacheKey  = crypto.createHash('md5').update(`${sceneText}|${visual}`).digest('hex').slice(0, 12);
  const fileName  = `scene_${cacheKey}.png`;
  const savePath  = path.join(GENERATED_DIR, fileName);
  const servePath = `/data/images/generated/${fileName}`;

  const prompt = `Bright cartoon-style educational illustration for Grade 3 maths.
Topic: "${topic}" | Scene: "${visual || sceneText.slice(0, 80)}"
Style: simple flat cartoon, bright cheerful colours, Indian cultural context, child-friendly, NO text or numbers in image, white background.`;

  return generateImage({ prompt, savePath, servePath });
}

module.exports = { generateImage, generateSceneImage };
