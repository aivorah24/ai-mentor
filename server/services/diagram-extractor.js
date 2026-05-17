/**
 * diagram-extractor.js
 *
 * Extracts diagram/shape regions from worksheet PDFs using:
 * - pdfjs-dist + canvas: PDF → page images (no Ghostscript needed)
 * - sharp: image processing (grayscale, threshold, edge detection)
 * - Custom contour detection: finds rectangular diagram boxes
 * - Tesseract.js: OCR for text extraction (optional)
 *
 * No LLM needed — pure computer vision pipeline.
 *
 * Pipeline:
 *   PDF → page images → grayscale → threshold → connected component analysis
 *   → filter large rectangular regions → crop diagrams → save
 */

let sharp;
try { sharp = require('sharp'); } catch (e) { console.warn('[diagram-extractor] sharp not available:', e.message); }
const path  = require('path');
const fs    = require('fs');
const { v4: uuidv4 } = require('uuid');

const QUIZ_IMG_DIR = path.join(__dirname, '..', 'data', 'images', 'quiz');
if (!fs.existsSync(QUIZ_IMG_DIR)) fs.mkdirSync(QUIZ_IMG_DIR, { recursive: true });

// ── Lazy-load Tesseract ─────────────────────────────────────────────────────
let tesseractWorker = null;
async function getTesseract() {
  if (tesseractWorker) return tesseractWorker;
  const Tesseract = require('tesseract.js');
  tesseractWorker = await Tesseract.createWorker('eng');
  console.log('[diagram] Tesseract OCR worker ready');
  return tesseractWorker;
}

// ── Polyfills for pdfjs-dist in Node.js ─────────────────────────────────────
function applyPolyfills() {
  const { createCanvas, Image, ImageData } = require('@napi-rs/canvas');
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;
        if (Array.isArray(init) && init.length===6) {
          [this.a,this.b,this.c,this.d,this.e,this.f]=init;
        }
        this.is2D=true;this.isIdentity=true;
      }
      multiply()  { return new globalThis.DOMMatrix(); }
      translate() { return new globalThis.DOMMatrix(); }
      scale()     { return new globalThis.DOMMatrix(); }
      rotate()    { return new globalThis.DOMMatrix(); }
      inverse()   { return new globalThis.DOMMatrix(); }
      transformPoint(p) { return p || { x:0, y:0 }; }
    };
  }
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData;
  if (typeof globalThis.Image    === 'undefined') globalThis.Image     = Image;
  return createCanvas;
}

// ── Convert PDF buffer to page images using pdfjs-dist + canvas ─────────────
async function pdfToImages(pdfBuffer, scale = 2.0) {
  const createCanvas = applyPolyfills();
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { pathToFileURL } = require('url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  ).href;

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages = [];
  const maxPages = Math.min(pdfDoc.numPages, 6); // Cap at 6 pages — worksheets rarely exceed this; prevents OOM on Cloud Run

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');

      const NodeCanvasFactory = {
        create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; },
        reset(obj, w, h) { obj.canvas.width = w; obj.canvas.height = h; },
        destroy() {},
      };

      await page.render({ canvasContext: ctx, viewport, canvasFactory: NodeCanvasFactory }).promise;
      const pngBuffer = await canvas.encode('png');

      pages.push({ pageNum, buffer: Buffer.from(pngBuffer) });
      console.log(`[diagram] Rendered page ${pageNum}/${maxPages} (${pngBuffer.length} bytes, ${Math.ceil(viewport.width)}x${Math.ceil(viewport.height)})`);
    } catch (err) {
      console.error(`[diagram] Page ${pageNum} render failed:`, err.message);
    }
  }

  if (pages.length === 0) {
    throw new Error('Could not render any PDF pages to images');
  }

  return pages;
}

// ── Connected component labeling (flood-fill based) ─────────────────────────
/**
 * Finds connected white regions in a binary image (inverted threshold).
 * Returns bounding boxes of significant dark-bordered regions.
 */
function findConnectedRegions(binaryData, width, height, minArea = 15000) {
  // binaryData: Uint8Array where 255 = foreground (dark pixels), 0 = background (white)
  const visited = new Uint8Array(width * height);
  const regions = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || binaryData[idx] === 0) continue;

      // BFS flood fill to find connected foreground region
      const queue = [idx];
      visited[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y;
      let pixelCount = 0;

      while (queue.length > 0) {
        const cidx = queue.shift();
        const cy = Math.floor(cidx / width);
        const cx = cidx % width;
        pixelCount++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-connected neighbors
        const neighbors = [
          cy > 0 ? (cy - 1) * width + cx : -1,
          cy < height - 1 ? (cy + 1) * width + cx : -1,
          cx > 0 ? cy * width + (cx - 1) : -1,
          cx < width - 1 ? cy * width + (cx + 1) : -1,
        ];

        for (const nidx of neighbors) {
          if (nidx >= 0 && !visited[nidx] && binaryData[nidx] > 0) {
            visited[nidx] = 1;
            queue.push(nidx);
          }
        }
      }

      const rw = maxX - minX + 1;
      const rh = maxY - minY + 1;
      const area = rw * rh;

      if (area >= minArea) {
        regions.push({
          x: minX, y: minY, w: rw, h: rh,
          area,
          pixelCount,
          fillRatio: pixelCount / area, // How much of the bounding box is filled
        });
      }
    }
  }

  return regions;
}

// ── Row/column projection for finding bordered boxes ────────────────────────
/**
 * Uses horizontal and vertical projection profiles to find rectangular
 * bordered regions (common in worksheets).
 *
 * This is more reliable than flood fill for detecting question boxes
 * because worksheet borders create clear horizontal/vertical lines.
 */
function findBorderedBoxes(binaryData, width, height, options = {}) {
  const {
    lineThreshold = 0.3,  // % of row/col that must be dark to count as a line
    minBoxWidth = 100,
    minBoxHeight = 80,
    minArea = 15000,
  } = options;

  // Horizontal projection: count dark pixels per row
  const hProj = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (binaryData[y * width + x] > 0) count++;
    }
    hProj[y] = count / width;
  }

  // Vertical projection: count dark pixels per column
  const vProj = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (binaryData[y * width + x] > 0) count++;
    }
    vProj[x] = count / height;
  }

  // Find horizontal lines (rows with high dark pixel density)
  const hLines = [];
  for (let y = 0; y < height; y++) {
    if (hProj[y] >= lineThreshold) {
      if (hLines.length === 0 || y - hLines[hLines.length - 1] > 5) {
        hLines.push(y);
      }
    }
  }

  // Find vertical lines (columns with high dark pixel density)
  const vLines = [];
  for (let x = 0; x < width; x++) {
    if (vProj[x] >= lineThreshold) {
      if (vLines.length === 0 || x - vLines[vLines.length - 1] > 5) {
        vLines.push(x);
      }
    }
  }

  // Build candidate boxes from intersections of h-lines and v-lines
  const boxes = [];
  for (let i = 0; i < hLines.length - 1; i++) {
    for (let j = i + 1; j < hLines.length; j++) {
      for (let k = 0; k < vLines.length - 1; k++) {
        for (let l = k + 1; l < vLines.length; l++) {
          const bx = vLines[k];
          const by = hLines[i];
          const bw = vLines[l] - vLines[k];
          const bh = hLines[j] - hLines[i];

          if (bw >= minBoxWidth && bh >= minBoxHeight && bw * bh >= minArea) {
            boxes.push({ x: bx, y: by, w: bw, h: bh, area: bw * bh });
          }
        }
      }
    }
  }

  return boxes;
}

// ── Main detection: combine approaches ──────────────────────────────────────
/**
 * Detects diagram regions in a page image using:
 * 1. Binary threshold to find dark lines/borders
 * 2. Projection-based box detection (for bordered worksheet sections)
 * 3. Connected component analysis (for standalone shapes)
 * 4. Smart filtering to remove text-heavy regions
 */
async function detectDiagramRegions(imageBuffer, options = {}) {
  const {
    minArea = 15000,
    maxAreaRatio = 0.85,
    threshValue = 200,
    marginPx = 15,
  } = options;

  const metadata = await sharp(imageBuffer).metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;
  const imgArea = imgW * imgH;

  // Convert to grayscale raw pixels
  const grayBuffer = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer();

  // Binary threshold (invert: dark pixels become 255, white becomes 0)
  const binary = new Uint8Array(imgW * imgH);
  for (let i = 0; i < grayBuffer.length; i++) {
    binary[i] = grayBuffer[i] < threshValue ? 255 : 0;
  }

  // Approach 1: Find bordered boxes (works great for worksheets with ruled sections)
  let boxes = findBorderedBoxes(binary, imgW, imgH, { minArea });
  console.log(`[diagram] Projection: ${boxes.length} bordered boxes found`);

  // Approach 2: Connected component analysis (for standalone shapes without borders)
  const ccRegions = findConnectedRegions(binary, imgW, imgH, minArea);
  // Only add CC regions that don't overlap with detected boxes
  for (const cc of ccRegions) {
    if (cc.fillRatio > 0.8) continue; // Skip nearly solid regions (likely text blocks)
    if (cc.fillRatio < 0.01) continue; // Skip nearly empty regions
    const overlaps = boxes.some(b => {
      const ox = Math.max(0, Math.min(b.x + b.w, cc.x + cc.w) - Math.max(b.x, cc.x));
      const oy = Math.max(0, Math.min(b.y + b.h, cc.y + cc.h) - Math.max(b.y, cc.y));
      return (ox * oy) / Math.min(b.area, cc.area) > 0.3;
    });
    if (!overlaps) boxes.push(cc);
  }

  // Filter by size and aspect ratio
  const filtered = boxes.filter(r => {
    const aspect = r.w / r.h;
    return (
      r.area >= minArea &&
      r.area / imgArea <= maxAreaRatio &&
      aspect >= 0.15 &&
      aspect <= 6
    );
  });

  // Apply margin and clamp to image bounds
  const regions = filtered.map(r => ({
    x: Math.max(0, r.x - marginPx),
    y: Math.max(0, r.y - marginPx),
    w: Math.min(imgW - Math.max(0, r.x - marginPx), r.w + 2 * marginPx),
    h: Math.min(imgH - Math.max(0, r.y - marginPx), r.h + 2 * marginPx),
    area: r.area,
  }));

  // Sort by vertical position (top to bottom), then left to right
  regions.sort((a, b) => a.y - b.y || a.x - b.x);

  // Remove overlapping regions (keep the larger one)
  const deduplicated = [];
  for (const r of regions) {
    const overlaps = deduplicated.some(f => {
      const ox = Math.max(0, Math.min(f.x + f.w, r.x + r.w) - Math.max(f.x, r.x));
      const oy = Math.max(0, Math.min(f.y + f.h, r.y + r.h) - Math.max(f.y, r.y));
      return (ox * oy) / Math.min(f.area, r.area) > 0.4;
    });
    if (!overlaps) deduplicated.push(r);
  }

  console.log(`[diagram] Final: ${deduplicated.length} diagram regions (from ${boxes.length} candidates)`);
  return deduplicated;
}

// ── Crop a region from an image buffer ──────────────────────────────────────
async function cropRegion(imageBuffer, region) {
  return sharp(imageBuffer)
    .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
    .png()
    .toBuffer();
}

// ── OCR a cropped image region ──────────────────────────────────────────────
async function ocrRegion(imageBuffer) {
  try {
    const worker = await getTesseract();
    const { data } = await worker.recognize(imageBuffer);
    return {
      text: data.text.trim(),
      confidence: data.confidence,
    };
  } catch (err) {
    console.error('[diagram] OCR error:', err.message);
    return { text: '', confidence: 0 };
  }
}

// ── OCR entire PDF — extract all text from all pages ────────────────────────
/**
 * Renders each PDF page and runs Tesseract OCR on the full page image.
 * Returns structured text per page.
 */
async function ocrFullPDF(pdfBuffer, scale = 1.5) {
  const pages = await pdfToImages(pdfBuffer, scale);
  const worker = await getTesseract();
  const results = [];

  for (const page of pages) {
    console.log(`[ocr] Running Tesseract on page ${page.pageNum}...`);
    const { data } = await worker.recognize(page.buffer);
    results.push({
      pageNum: page.pageNum,
      text: data.text.trim(),
      confidence: data.confidence,
    });
    console.log(`[ocr] Page ${page.pageNum}: ${data.text.length} chars, confidence ${data.confidence}%`);
  }

  const fullText = results.map(r => r.text).join('\n\n');
  return { pages: results, fullText };
}

// ── Analyze if region is text-heavy or diagram-heavy ────────────────────────
/**
 * Uses OCR + pixel analysis to decide if a cropped region is a diagram.
 *
 * Strategy: Run Tesseract on the crop. If OCR explains most of the dark pixels
 * (high confidence, lots of recognized text), it's text. If there are many
 * dark pixels that OCR can't explain, it's a diagram (shapes, arrows, curves).
 *
 * Also strips table borders (long horizontal/vertical lines) before analysis,
 * since worksheets wrap everything in tables.
 */
async function analyzeRegionContent(croppedBuffer) {
  const meta = await sharp(croppedBuffer).metadata();
  const w = meta.width, h = meta.height;

  // Quick rejects
  if (w < 60 || h < 60) return 'noise';
  if (w / h > 4 && h < 80) return 'text-line';

  // Get grayscale raw pixels
  const grayBuf = await sharp(croppedBuffer).grayscale().raw().toBuffer();
  const totalPixels = w * h;

  // Step 1: Remove border lines (top/bottom/left/right edge rows that are mostly dark)
  // This prevents table borders from inflating dark pixel counts
  const isBorderRow = (y) => {
    let dark = 0;
    for (let x = 0; x < w; x++) if (grayBuf[y * w + x] < 100) dark++;
    return dark / w > 0.5;
  };
  const isBorderCol = (x) => {
    let dark = 0;
    for (let y = 0; y < h; y++) if (grayBuf[y * w + x] < 100) dark++;
    return dark / h > 0.5;
  };

  // Find inner content bounds (skip border lines)
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < h - 1 && isBorderRow(top)) top++;
  while (bottom > top && isBorderRow(bottom)) bottom--;
  while (left < w - 1 && isBorderCol(left)) left++;
  while (right > left && isBorderCol(right)) right--;

  // Add small margin inside borders
  top = Math.min(top + 3, bottom);
  bottom = Math.max(bottom - 3, top);
  left = Math.min(left + 3, right);
  right = Math.max(right - 3, left);

  const innerW = right - left + 1;
  const innerH = bottom - top + 1;
  const innerArea = innerW * innerH;

  if (innerArea < 2000) return 'noise';

  // Step 2: Count dark pixels in inner region (excluding borders)
  let innerDark = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (grayBuf[y * w + x] < 140) innerDark++;
    }
  }
  const innerDarkRatio = innerDark / innerArea;

  // Step 3: Detect long straight lines (table grid lines inside the crop)
  // Count rows/columns that are mostly dark (these are internal grid lines)
  let gridLinePixels = 0;
  for (let y = top; y <= bottom; y++) {
    let rowDark = 0;
    for (let x = left; x <= right; x++) {
      if (grayBuf[y * w + x] < 100) rowDark++;
    }
    if (rowDark / innerW > 0.6) gridLinePixels += rowDark;
  }
  for (let x = left; x <= right; x++) {
    let colDark = 0;
    for (let y = top; y <= bottom; y++) {
      if (grayBuf[y * w + x] < 100) colDark++;
    }
    if (colDark / innerH > 0.6) gridLinePixels += colDark;
  }

  // Dark pixels that aren't grid lines
  const contentDark = Math.max(0, innerDark - gridLinePixels);
  const contentDarkRatio = contentDark / innerArea;

  // Step 4: Count "thick" dark regions (blobs) — diagrams have larger continuous dark areas
  // Sample the center region and count connected dark pixel clusters
  let thickPixels = 0;
  for (let y = top + 5; y <= bottom - 5; y += 2) {
    for (let x = left + 5; x <= right - 5; x += 2) {
      const idx = y * w + x;
      if (grayBuf[idx] >= 140) continue;
      // Check if this is part of a thick stroke (2+ pixels wide in both directions)
      const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
      let darkNeighbors = 0;
      for (const n of neighbors) {
        if (n >= 0 && n < grayBuf.length && grayBuf[n] < 140) darkNeighbors++;
      }
      if (darkNeighbors >= 3) thickPixels++; // thick stroke (not thin text)
    }
  }
  const thickRatio = thickPixels / (innerArea / 4); // /4 because we sample every 2px

  // Step 5: Classification using pixel analysis + OCR tiebreaker
  //
  // Key insight: Bold text headers have similar thick/dark ratios to diagram shapes.
  // Use OCR confidence as tiebreaker: if Tesseract reads it well → text, else → diagram.

  // Nearly empty
  if (contentDarkRatio < 0.005) return 'empty';

  // Very high text density = definitely text
  if (contentDarkRatio > 0.12) return 'text';

  // Very low thick content = definitely text (thin strokes only)
  if (thickRatio < 0.012) return 'text';

  // Ambiguous zone (thick 0.012-0.08, dark 0.005-0.12): use OCR density tiebreaker
  //
  // Text density = OCR chars / area * 10000
  //   Text regions: density > 5 (many words, sentences)
  //   Diagrams with labels: density < 4 (few short labels like "5m", "kL")
  //
  try {
    const worker = await getTesseract();
    const { data } = await worker.recognize(croppedBuffer);
    const ocrText = (data.text || '').trim();
    const charCount = ocrText.replace(/\s+/g, '').length;
    const textDensity = (charCount / innerArea) * 10000;

    // High text density = text (sentences, paragraphs)
    if (textDensity > 5) return 'text';

    // Low text density = diagram (shapes with few labels)
    if (textDensity < 3) return 'diagram';

    // Mid-range: use confidence + thick ratio
    const ocrConf = data.confidence || 0;
    if (ocrConf > 80 && textDensity >= 3) return 'text';
    if (thickRatio >= 0.03) return 'diagram';

    return 'mixed';
  } catch {
    // OCR failed — fall back to pixel-only heuristics
    if (contentDarkRatio > 0.08) return 'text';
    if (thickRatio >= 0.025 && contentDarkRatio >= 0.02 && contentDarkRatio < 0.08) return 'diagram';
    if (thickRatio < 0.015) return 'text';
    return 'mixed';
  }
}

// ── Full extraction pipeline ────────────────────────────────────────────────
async function extractDiagrams(pdfBuffer, quizId, options = {}) {
  const {
    scale = 1.5,             // pdfjs render scale (1.5 = ~150 DPI, good for detection)
    doOCR = false,
    minArea = 15000,
    maxRegions = 20,
  } = options;

  console.log(`[diagram] Starting extraction (quizId: ${quizId}, scale: ${scale})`);

  // Step 1: Convert PDF to page images
  const pages = await pdfToImages(pdfBuffer, scale);
  console.log(`[diagram] Rendered ${pages.length} pages`);

  const result = {
    pages: [],
    diagrams: [],
    fullPageImages: [],
  };

  for (const page of pages) {
    // Save full page image
    const pageImgName = `${quizId}_page${page.pageNum}.png`;
    const pageImgPath = path.join(QUIZ_IMG_DIR, pageImgName);
    fs.writeFileSync(pageImgPath, page.buffer);
    const pageImageUrl = `/data/images/quiz/${pageImgName}`;
    result.fullPageImages.push({ pageNum: page.pageNum, imageUrl: pageImageUrl });

    // Step 2: Detect diagram regions
    let regions;
    try {
      regions = await detectDiagramRegions(page.buffer, { minArea });
    } catch (err) {
      console.error(`[diagram] Detection failed on page ${page.pageNum}:`, err.message);
      result.pages.push({ pageNum: page.pageNum, imageUrl: pageImageUrl, regions: [] });
      continue;
    }

    regions = regions.slice(0, maxRegions);

    const pageRegions = [];
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const cropId = `${quizId}_p${page.pageNum}_crop${i}`;

      // Crop the region
      const croppedBuffer = await cropRegion(page.buffer, region);

      // Analyze content type
      const contentType = await analyzeRegionContent(croppedBuffer);

      // Only keep diagrams and mixed content — skip text, text-lines, noise, empty
      if (contentType !== 'diagram' && contentType !== 'mixed') {
        console.log(`[diagram] Skipping ${cropId}: ${contentType}`);
        continue;
      }

      // Save cropped image
      const cropName = `${cropId}.png`;
      const cropPath = path.join(QUIZ_IMG_DIR, cropName);
      fs.writeFileSync(cropPath, croppedBuffer);
      const cropUrl = `/data/images/quiz/${cropName}`;

      const diagramEntry = {
        id: cropId,
        pageNum: page.pageNum,
        imageUrl: cropUrl,
        bbox: { x: region.x, y: region.y, w: region.w, h: region.h },
        area: region.area,
        contentType,
      };

      // Optional: OCR
      if (doOCR) {
        try {
          const ocr = await ocrRegion(croppedBuffer);
          diagramEntry.ocrText = ocr.text;
          diagramEntry.ocrConfidence = ocr.confidence;
        } catch {
          diagramEntry.ocrText = '';
        }
      }

      pageRegions.push(diagramEntry);
      result.diagrams.push(diagramEntry);
      console.log(`[diagram] Crop ${i}: ${region.w}x${region.h} @ (${region.x},${region.y}) [${contentType}] → ${cropUrl}`);
    }

    result.pages.push({
      pageNum: page.pageNum,
      imageUrl: pageImageUrl,
      regions: pageRegions,
    });
  }

  console.log(`[diagram] Extraction complete: ${result.diagrams.length} diagrams from ${pages.length} pages`);
  return result;
}

// ── Extract diagrams from a raw image buffer (not PDF) ─────────────────────
async function extractDiagramsFromImage(imageBuffer, quizId, options = {}) {
  const {
    doOCR = false,
    minArea = 15000,
    maxRegions = 20,
  } = options;

  console.log(`[diagram] Starting image extraction (quizId: ${quizId})`);

  // Ensure we have a PNG buffer for consistent processing
  const pngBuffer = await sharp(imageBuffer).png().toBuffer();

  // Treat the single image as page 1
  const pages = [{ pageNum: 1, buffer: pngBuffer }];

  const result = {
    pages: [],
    diagrams: [],
    fullPageImages: [],
  };

  for (const page of pages) {
    // Save full page image
    const pageImgName = `${quizId}_page${page.pageNum}.png`;
    const pageImgPath = path.join(QUIZ_IMG_DIR, pageImgName);
    fs.writeFileSync(pageImgPath, page.buffer);
    const pageImageUrl = `/data/images/quiz/${pageImgName}`;
    result.fullPageImages.push({ pageNum: page.pageNum, imageUrl: pageImageUrl });

    // Detect diagram regions
    let regions;
    try {
      regions = await detectDiagramRegions(page.buffer, { minArea });
    } catch (err) {
      console.error(`[diagram] Detection failed on image:`, err.message);
      result.pages.push({ pageNum: page.pageNum, imageUrl: pageImageUrl, regions: [] });
      continue;
    }

    regions = regions.slice(0, maxRegions);

    const pageRegions = [];
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const cropId = `${quizId}_p${page.pageNum}_crop${i}`;

      const croppedBuffer = await cropRegion(page.buffer, region);
      const contentType = await analyzeRegionContent(croppedBuffer);

      if (contentType !== 'diagram' && contentType !== 'mixed') {
        console.log(`[diagram] Skipping ${cropId}: ${contentType}`);
        continue;
      }

      const cropName = `${cropId}.png`;
      const cropPath = path.join(QUIZ_IMG_DIR, cropName);
      fs.writeFileSync(cropPath, croppedBuffer);
      const cropUrl = `/data/images/quiz/${cropName}`;

      const diagramEntry = {
        id: cropId,
        pageNum: page.pageNum,
        imageUrl: cropUrl,
        bbox: { x: region.x, y: region.y, w: region.w, h: region.h },
        area: region.area,
        contentType,
      };

      if (doOCR) {
        try {
          const ocr = await ocrRegion(croppedBuffer);
          diagramEntry.ocrText = ocr.text;
          diagramEntry.ocrConfidence = ocr.confidence;
        } catch {
          diagramEntry.ocrText = '';
        }
      }

      pageRegions.push(diagramEntry);
      result.diagrams.push(diagramEntry);
      console.log(`[diagram] Crop ${i}: ${region.w}x${region.h} @ (${region.x},${region.y}) [${contentType}] → ${cropUrl}`);
    }

    result.pages.push({
      pageNum: page.pageNum,
      imageUrl: pageImageUrl,
      regions: pageRegions,
    });
  }

  console.log(`[diagram] Image extraction complete: ${result.diagrams.length} diagrams`);
  return result;
}

// ── Smart diagram-to-question matching ──────────────────────────────────────
/**
 * Matches ML-detected figures to quiz questions using:
 *  1. Global per-page figure pool (not reset per task)
 *  2. Skip topmost extras when more figures than questions (concept illustrations)
 *  3. Row-aware sorting: figures at same y grouped into rows, sorted left-to-right
 *     (handles two-column worksheet layouts like Task 1a left, Task 1b right)
 */
function matchDiagramsToQuestions(extractionResult, quiz) {
  const { diagrams, fullPageImages } = extractionResult;

  // Step 1: Attach full page images to tasks
  for (const task of (quiz.tasks || [])) {
    const sourcePage = task.sourcePage || 1;
    const pageImg = fullPageImages.find(p => p.pageNum === sourcePage);
    if (pageImg) task.pageImageUrl = pageImg.imageUrl;
  }

  // Step 2: Group figures by page, sorted top-to-bottom
  const figuresByPage = {};
  for (const d of diagrams) {
    if (d.contentType === 'text') continue;
    const pg = d.pageNum;
    if (!figuresByPage[pg]) figuresByPage[pg] = [];
    figuresByPage[pg].push(d);
  }
  for (const pg of Object.keys(figuresByPage)) {
    figuresByPage[pg].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  }

  // Step 2.5: Auto-correct sourcePage when LLM assigns all tasks to page 1
  // If all tasks say page 1 but figures exist on other pages, spread tasks across pages
  const totalPages = Object.keys(figuresByPage).length || fullPageImages.length || 1;
  const allOnPage1 = (quiz.tasks || []).every(t => !t.sourcePage || t.sourcePage === 1);
  if (allOnPage1 && totalPages > 1) {
    const tasksWithImg = (quiz.tasks || []).filter(t => (t.questions || []).some(q => q.hasImage));
    if (tasksWithImg.length > 0) {
      // Count total figures per page
      const pagesWithFigs = Object.keys(figuresByPage).map(Number).sort((a, b) => a - b);
      // Assign tasks to pages proportionally based on task order
      let taskIdx = 0;
      for (const pg of pagesWithFigs) {
        const figsOnPage = figuresByPage[pg].length;
        // Assign enough tasks to consume these figures
        let assigned = 0;
        while (taskIdx < tasksWithImg.length && assigned < figsOnPage) {
          const task = tasksWithImg[taskIdx];
          const imgQCount = (task.questions || []).filter(q => q.hasImage).length;
          task.sourcePage = pg;
          assigned += imgQCount;
          taskIdx++;
          console.log(`[diagram] Auto-corrected ${task.title?.substring(0, 30)} → page ${pg}`);
        }
      }
    }
  }

  // Step 3: Collect TASKS with hasImage questions, grouped by source page.
  // Key insight: multiple questions in the SAME task share ONE diagram (e.g. a bar graph
  // task has Q1, Q2, Q3 all referencing the same graph). We match figures to TASKS first,
  // then propagate to all questions within that task.
  const tasksByPage = {};
  for (const task of (quiz.tasks || [])) {
    const pg = task.sourcePage || 1;
    if (!tasksByPage[pg]) tasksByPage[pg] = [];
    const imgQuestions = (task.questions || []).filter(q => q.hasImage);
    if (imgQuestions.length > 0) {
      tasksByPage[pg].push({ task, imgQuestions });
    }
  }

  // Step 4: Match figures to questions per page
  // Strategy: For two-column tasks, match by x-position (left figures → left questions).
  // For single-column tasks, match by closest y-position.
  // Filter out likely headers/logos (very top of page AND aspect ratio > 4:1).
  for (const pg of Object.keys(tasksByPage)) {
    const tasks = tasksByPage[pg];
    const figures = figuresByPage[pg] || [];
    if (figures.length === 0 || tasks.length === 0) continue;

    // Filter out likely headers/logos: top 8% of page AND very wide (aspect > 3:1)
    const pageHeight = Math.max(...figures.map(f => f.bbox.y + f.bbox.h), 2000);
    const headerThreshold = pageHeight * 0.08;
    const contentFigures = figures.filter(f => {
      const aspect = f.bbox.w / Math.max(f.bbox.h, 1);
      const isHeader = f.bbox.y < headerThreshold && aspect > 3;
      if (isHeader) console.log(`[diagram] Skipping likely header: y=${f.bbox.y} w=${f.bbox.w} h=${f.bbox.h}`);
      return !isHeader;
    });

    // Count total questions needing images
    const totalImgQ = tasks.reduce((s, t) => s + t.imgQuestions.length, 0);

    for (const { task, imgQuestions } of tasks) {
      const layout = task.layout || {};
      const istwocol = layout.type === 'two-column' && layout.columnGroups?.length >= 2;

      if (istwocol && imgQuestions.length >= 2) {
        // TWO-COLUMN: Match by x-position — left figures to left-column Q, right to right-column Q
        const colGroups = layout.columnGroups;
        const leftQIds = new Set(colGroups[0].questionIds || []);
        const leftQs = imgQuestions.filter(q => leftQIds.has(q.id));
        const rightQs = imgQuestions.filter(q => !leftQIds.has(q.id));

        // Find unmatched figures on this page, sort by x
        const available = contentFigures.filter(f => !f._matched);
        if (available.length < 2) {
          // Not enough figures — assign what we have
          if (available.length === 1 && imgQuestions.length > 0) {
            imgQuestions[0].imageUrl = available[0].imageUrl;
            imgQuestions[0].diagramBbox = available[0].bbox;
            available[0]._matched = true;
          }
          continue;
        }

        // Sort available by x-position
        const byX = [...available].sort((a, b) => a.bbox.x - b.bbox.x);
        // Left half = figures with x < midpoint, right half = rest
        const midX = byX[0].bbox.x + (byX[byX.length - 1].bbox.x - byX[0].bbox.x) / 2;
        const leftFigs = byX.filter(f => f.bbox.x + f.bbox.w / 2 <= midX);
        const rightFigs = byX.filter(f => f.bbox.x + f.bbox.w / 2 > midX);

        // Assign left figures to left questions
        for (let i = 0; i < leftQs.length && i < leftFigs.length; i++) {
          leftQs[i].imageUrl = leftFigs[i].imageUrl;
          leftQs[i].diagramBbox = leftFigs[i].bbox;
          leftFigs[i]._matched = true;
          console.log(`[diagram] 2-col LEFT: ${leftFigs[i].imageUrl?.split('/').pop()} → Q(${leftQs[i].id}) x=${leftFigs[i].bbox.x}`);
        }
        // Assign right figures to right questions
        for (let i = 0; i < rightQs.length && i < rightFigs.length; i++) {
          rightQs[i].imageUrl = rightFigs[i].imageUrl;
          rightQs[i].diagramBbox = rightFigs[i].bbox;
          rightFigs[i]._matched = true;
          console.log(`[diagram] 2-col RIGHT: ${rightFigs[i].imageUrl?.split('/').pop()} → Q(${rightQs[i].id}) x=${rightFigs[i].bbox.x}`);
        }
      } else {
        // SINGLE-COLUMN: Match closest unmatched figure by y-position
        const available = contentFigures.filter(f => !f._matched);
        if (available.length === 0) continue;

        if (imgQuestions.length === 1) {
          // Single question — find closest figure
          const fig = available[0]; // closest by y (already sorted)
          imgQuestions[0].imageUrl = fig.imageUrl;
          imgQuestions[0].diagramBbox = fig.bbox;
          fig._matched = true;
          console.log(`[diagram] Single match: ${fig.imageUrl?.split('/').pop()} → ${task.title?.substring(0, 30)} Q(${imgQuestions[0].id})`);
        } else {
          // Multiple questions, single column — assign sequentially by y
          const byY = [...available].sort((a, b) => a.bbox.y - b.bbox.y);
          for (let i = 0; i < imgQuestions.length && i < byY.length; i++) {
            imgQuestions[i].imageUrl = byY[i].imageUrl;
            imgQuestions[i].diagramBbox = byY[i].bbox;
            byY[i]._matched = true;
            console.log(`[diagram] Seq match: ${byY[i].imageUrl?.split('/').pop()} → Q(${imgQuestions[i].id})`);
          }
        }
      }
    }
  }

  // Step 5: Column-group diagram matching
  // When Gemini sets hasDiagram on column groups but not hasImage on questions,
  // assign unmatched figures to the first question of each column group.
  for (const task of (quiz.tasks || [])) {
    const layout = task.layout || {};
    const colGroups = layout.columnGroups || [];
    if (layout.type !== 'two-column' || colGroups.length < 2) continue;

    const pg = task.sourcePage || 1;
    const figures = figuresByPage[pg] || [];
    const unmatched = figures.filter(f => !f._matched);
    if (unmatched.length === 0) continue;

    const questionsById = {};
    for (const q of (task.questions || [])) questionsById[q.id] = q;

    let unmatchedIdx = 0;
    for (const group of colGroups) {
      if (!group.hasDiagram || unmatchedIdx >= unmatched.length) continue;
      const firstQId = (group.questionIds || [])[0];
      const firstQ = firstQId ? questionsById[firstQId] : null;
      if (firstQ && !firstQ.imageUrl) {
        const fig = unmatched[unmatchedIdx++];
        firstQ.imageUrl = fig.imageUrl;
        firstQ.diagramBbox = fig.bbox;
        fig._matched = true;
        console.log(`[diagram] Column-group match: ${fig.id || fig.imageUrl} → ${task.title} colGroup Q(${firstQ.id})`);
      }
    }
  }

  // Step 6: Fallback — match remaining hasImage questions with no imageUrl
  // LLM often sets all sourcePage=1 even for multi-page PDFs, so unmatched
  // figures on later pages never get assigned. Collect all unmatched figures
  // across ALL pages and assign them to unmatched hasImage questions in order.
  const allUnmatched = [];
  for (const pg of Object.keys(figuresByPage)) {
    for (const fig of figuresByPage[pg]) {
      if (!fig._matched) allUnmatched.push(fig);
    }
  }

  if (allUnmatched.length > 0) {
    const orphanQuestions = [];
    for (const task of (quiz.tasks || [])) {
      for (const q of (task.questions || [])) {
        if (q.hasImage && !q.imageUrl) {
          orphanQuestions.push({ task, q });
        }
      }
    }

    // Group orphan questions by task, then match figures per-task or per-question
    const orphanTasks = [];
    let currentTask = null;
    for (const { task, q } of orphanQuestions) {
      if (!currentTask || currentTask.task !== task) {
        currentTask = { task, questions: [] };
        orphanTasks.push(currentTask);
      }
      currentTask.questions.push(q);
    }

    let figIdx = 0;
    for (const { task, questions } of orphanTasks) {
      if (figIdx >= allUnmatched.length) break;
      const remaining = allUnmatched.length - figIdx;

      if (questions.length > 1 && remaining >= questions.length) {
        // Per-question matching
        for (const q of questions) {
          if (figIdx >= allUnmatched.length) break;
          const fig = allUnmatched[figIdx++];
          q.imageUrl = fig.imageUrl;
          q.diagramBbox = fig.bbox;
          fig._matched = true;
          console.log(`[diagram] Fallback per-Q: ${fig.imageUrl} → ${task.title} Q(${q.id})`);
        }
      } else {
        // Per-task: all questions share one figure
        const fig = allUnmatched[figIdx++];
        for (const q of questions) {
          q.imageUrl = fig.imageUrl;
          q.diagramBbox = fig.bbox;
        }
        fig._matched = true;
        console.log(`[diagram] Fallback per-task: ${fig.imageUrl} → ${task.title} Q(${questions.map(q => q.id).join(',')})`);
      }
    }

    if (figIdx > 0) console.log(`[diagram] Fallback matched ${figIdx} figures to orphan questions`);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
async function cleanup() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

module.exports = {
  extractDiagrams,
  extractDiagramsFromImage,
  detectDiagramRegions,
  analyzeRegionContent,
  matchDiagramsToQuestions,
  ocrFullPDF,
  cropRegion,
  ocrRegion,
  pdfToImages,
  cleanup,
};
