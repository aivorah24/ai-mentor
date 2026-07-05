"""
Aivorah Document Layout Detection Microservice

Uses DocLayout-YOLO (ML-based) to detect figures, tables, text regions
in worksheet PDFs/images with precise pixel-level bounding boxes.

Endpoints:
  POST /detect    — Upload PDF/image → get layout regions (bboxes + types)
  POST /crop      — Upload PDF/image → get cropped figure images saved to disk
  GET  /health    — Health check

Runs on port 5050 (configurable via LAYOUT_PORT env var).
"""

import os
import sys
import json
import time
import base64
import traceback
import threading
from io import BytesIO
from pathlib import Path

# ── Disable Ultralytics' anonymous analytics sync BEFORE importing doclayout_yolo ──
# `import doclayout_yolo` pulls in ultralytics, which — unless its settings file already
# says sync:false — makes a network call as part of import/first-use. On a machine with
# no internet access (or a flaky one), that call blocks until it times out, which measured
# ~10 minutes here. That 10-minute stall was the entire cause of "picture crop not
# appearing" and "generation taking forever" — the model itself loads in ~0.2s once the
# import finally completes. Writing sync:false (and disabling every other phone-home
# integration) into Ultralytics' settings file here, before the import line below,  makes
# this fix self-contained: it works on a fresh machine/deploy with no manual setup step.
try:
    import yaml
    _ultra_settings_path = os.path.join(
        os.environ.get('APPDATA') or os.path.expanduser('~/.config'),
        'Ultralytics', 'settings.yaml'
    )
    os.makedirs(os.path.dirname(_ultra_settings_path), exist_ok=True)
    _ultra_settings = {}
    if os.path.exists(_ultra_settings_path):
        with open(_ultra_settings_path, 'r') as f:
            _ultra_settings = yaml.safe_load(f) or {}
    _offline_overrides = {
        'sync': False, 'clearml': False, 'comet': False, 'dvc': False, 'hub': False,
        'mlflow': False, 'neptune': False, 'raytune': False, 'tensorboard': False, 'wandb': False,
    }
    if any(_ultra_settings.get(k) is not v for k, v in _offline_overrides.items()):
        _ultra_settings.update(_offline_overrides)
        with open(_ultra_settings_path, 'w') as f:
            yaml.safe_dump(_ultra_settings, f)
        print('[layout] Disabled Ultralytics analytics sync (offline-safe)')
except Exception as e:
    print(f'[layout] Could not pre-configure Ultralytics offline settings ({e}) — import may hang without internet')

import fitz  # PyMuPDF
from PIL import Image
from flask import Flask, request, jsonify

# Serializes all YOLO inference calls. This is CPU-bound model inference — running two
# requests "concurrently" on a CPU-only machine doesn't parallelize, it just makes both
# requests fight over the same cores and take far longer than running one after another.
# Without this lock, a burst of overlapping requests (e.g. several quiz generations at
# once) could each individually stall for many minutes instead of queuing predictably.
_inference_lock = threading.Lock()

# ── Config ───────────────────────────────────────────────────────────────────
PORT = int(os.environ.get('LAYOUT_PORT', 5050))
DPI = int(os.environ.get('LAYOUT_DPI', 200))
CONF_THRESHOLD = float(os.environ.get('LAYOUT_CONF', 0.25))
IMG_SIZE = int(os.environ.get('LAYOUT_IMGSZ', 1024))

# Where to save cropped images (same as Node.js quiz image dir)
CROP_DIR = os.environ.get(
    'CROP_DIR',
    os.path.join(os.path.dirname(__file__), '..', 'data', 'images', 'quiz')
)
os.makedirs(CROP_DIR, exist_ok=True)

# Model path
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
MODEL_REPO = 'juliozhao/DocLayout-YOLO-DocStructBench'
MODEL_FILE = 'doclayout_yolo_docstructbench_imgsz1024.pt'

# ── Lazy-load model ──────────────────────────────────────────────────────────
_model = None

def get_model():
    global _model
    if _model is not None:
        return _model

    from doclayout_yolo import YOLOv10

    # Find model file in HF cache
    model_path = None
    for root, dirs, files in os.walk(MODEL_DIR):
        for f in files:
            if f == MODEL_FILE:
                model_path = os.path.join(root, f)
                break
        if model_path:
            break

    if not model_path:
        print(f'[layout] Model not found in {MODEL_DIR}, downloading...')
        from huggingface_hub import hf_hub_download
        model_path = hf_hub_download(
            repo_id=MODEL_REPO,
            filename=MODEL_FILE,
            cache_dir=MODEL_DIR
        )

    print(f'[layout] Loading DocLayout-YOLO from: {model_path}')
    _model = YOLOv10(model_path)
    print(f'[layout] Model loaded. Classes: {_model.names}')
    return _model


# ── PDF / Image → page images ───────────────────────────────────────────────
def pdf_to_images(pdf_bytes, dpi=DPI):
    """Convert PDF bytes to list of PIL Images, one per page."""
    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    pages = []
    max_pages = min(doc.page_count, 20)
    for i in range(max_pages):
        page = doc[i]
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        pages.append({'pageNum': i + 1, 'image': img, 'width': pix.width, 'height': pix.height})
    doc.close()
    return pages


def load_image(img_bytes):
    """Load image bytes as PIL Image."""
    img = Image.open(BytesIO(img_bytes)).convert('RGB')
    return [{'pageNum': 1, 'image': img, 'width': img.width, 'height': img.height}]


# ── Run layout detection on a single page image ─────────────────────────────
def detect_page_layout(model, pil_image, conf=CONF_THRESHOLD, imgsz=IMG_SIZE):
    """
    Run DocLayout-YOLO on a PIL image.
    Returns list of detected regions with bbox, type, confidence.
    """
    # Save to temp buffer for YOLO (it expects file path or numpy)
    import numpy as np
    img_np = np.array(pil_image)

    # Serialize inference — see _inference_lock definition for why.
    with _inference_lock:
        results = model.predict(img_np, imgsz=imgsz, conf=conf, verbose=False)

    regions = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = model.names[cls_id]
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]

            regions.append({
                'type': cls_name,
                'confidence': round(confidence, 3),
                'bbox': {
                    'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                    'width': x2 - x1, 'height': y2 - y1
                },
                'classId': cls_id,
            })

    # Sort by vertical position (top to bottom), then left to right
    regions.sort(key=lambda r: (r['bbox']['y1'], r['bbox']['x1']))

    # De-duplicate overlapping regions (keep higher confidence)
    regions = deduplicate_regions(regions)
    return regions


def deduplicate_regions(regions, iou_threshold=0.4):
    """Remove overlapping regions, keeping the one with higher confidence."""
    if len(regions) <= 1:
        return regions

    # Sort by confidence descending
    by_conf = sorted(regions, key=lambda r: r['confidence'], reverse=True)
    keep = []

    for region in by_conf:
        b = region['bbox']
        overlaps = False
        for kept in keep:
            kb = kept['bbox']
            # Calculate IoU (intersection over union)
            ix1 = max(b['x1'], kb['x1'])
            iy1 = max(b['y1'], kb['y1'])
            ix2 = min(b['x2'], kb['x2'])
            iy2 = min(b['y2'], kb['y2'])
            if ix1 < ix2 and iy1 < iy2:
                inter = (ix2 - ix1) * (iy2 - iy1)
                area_a = b['width'] * b['height']
                area_b = kb['width'] * kb['height']
                # Use intersection over smaller area (catches containment)
                min_area = min(area_a, area_b)
                if min_area > 0 and inter / min_area > iou_threshold:
                    overlaps = True
                    break
        if not overlaps:
            keep.append(region)

    # Re-sort by position (top to bottom, left to right)
    keep.sort(key=lambda r: (r['bbox']['y1'], r['bbox']['x1']))
    return keep


# ── Crop a region from a PIL image ──────────────────────────────────────────
def crop_region(pil_image, bbox, padding=10):
    """Crop a region from image with optional padding."""
    w, h = pil_image.size
    x1 = max(0, bbox['x1'] - padding)
    y1 = max(0, bbox['y1'] - padding)
    x2 = min(w, bbox['x2'] + padding)
    y2 = min(h, bbox['y2'] + padding)
    return pil_image.crop((x1, y1, x2, y2))


# ── Flask App ────────────────────────────────────────────────────────────────
app = Flask(__name__)


@app.route('/health', methods=['GET'])
def health():
    model_loaded = _model is not None
    result = {
        'status': 'ok',
        'model': 'DocLayout-YOLO-DocStructBench',
        'model_loaded': model_loaded,
        'config': {
            'dpi': DPI,
            'conf_threshold': CONF_THRESHOLD,
            'imgsz': IMG_SIZE,
        }
    }
    if model_loaded:
        result['classes'] = _model.names
    return jsonify(result)


@app.route('/pdf-to-images', methods=['POST'])
def pdf_to_images_endpoint():
    """
    Convert PDF to page images (no ML model needed).
    Returns saved page image paths for downstream subfigure extraction.
    """
    start = time.time()
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    quiz_id = request.args.get('quiz_id') or request.form.get('quiz_id') or 'unknown'
    file = request.files['file']
    file_bytes = file.read()
    fname = file.filename or 'upload'

    if fname.lower().endswith('.pdf'):
        pages = pdf_to_images(file_bytes)
    else:
        pages = load_image(file_bytes)

    result_pages = []
    for pg in pages:
        page_filename = f'{quiz_id}_page{pg["pageNum"]}.png'
        page_path = os.path.join(CROP_DIR, page_filename)
        pg['image'].save(page_path)
        result_pages.append({
            'pageNum': pg['pageNum'],
            'width': pg['width'],
            'height': pg['height'],
            'filename': page_filename,
            'fullPageUrl': f'/data/images/quiz/{page_filename}',
        })

    elapsed = round((time.time() - start) * 1000)
    return jsonify({
        'pages': result_pages,
        'timing_ms': elapsed,
    })


@app.route('/detect', methods=['POST'])
def detect():
    """
    Detect layout regions in uploaded PDF or image.

    Accepts: multipart file upload (field: 'file')
    Query params:
      - conf: confidence threshold (default 0.25)
      - types: comma-separated types to return (default: all)
               e.g. types=figure,table

    Returns JSON:
    {
      "pages": [
        {
          "pageNum": 1,
          "width": 1654,
          "height": 2339,
          "regions": [
            { "type": "figure", "confidence": 0.93, "bbox": {...} },
            { "type": "plain text", "confidence": 0.87, "bbox": {...} },
            ...
          ]
        }
      ],
      "summary": { "total_regions": 15, "figures": 4, "tables": 0, ... },
      "timing_ms": 2300
    }
    """
    start = time.time()

    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded. Use multipart field "file"'}), 400

    file = request.files['file']
    file_bytes = file.read()
    filename = file.filename or 'unknown'
    mime = file.content_type or ''

    conf = float(request.args.get('conf', CONF_THRESHOLD))
    type_filter = request.args.get('types', '').strip()
    filter_types = [t.strip() for t in type_filter.split(',') if t.strip()] if type_filter else None

    model = get_model()

    # Convert to page images
    if mime == 'application/pdf' or filename.lower().endswith('.pdf'):
        pages = pdf_to_images(file_bytes)
    else:
        pages = load_image(file_bytes)

    # Run detection on each page
    result_pages = []
    summary = {}

    for page in pages:
        regions = detect_page_layout(model, page['image'], conf=conf)

        # Apply type filter
        if filter_types:
            regions = [r for r in regions if r['type'] in filter_types]

        # Count by type
        for r in regions:
            t = r['type']
            summary[t] = summary.get(t, 0) + 1

        result_pages.append({
            'pageNum': page['pageNum'],
            'width': page['width'],
            'height': page['height'],
            'regions': regions,
        })

    elapsed = round((time.time() - start) * 1000)
    total = sum(summary.values())

    return jsonify({
        'pages': result_pages,
        'summary': {**summary, 'total_regions': total},
        'timing_ms': elapsed,
    })


@app.route('/crop', methods=['POST'])
def crop():
    """
    Detect figures/tables in uploaded PDF or image, crop them, and save to disk.

    Accepts: multipart file upload (field: 'file')
    Query params:
      - quiz_id: unique quiz ID for naming crops (required)
      - conf: confidence threshold (default 0.25)
      - types: types to crop (default: figure,table)
      - padding: pixels of padding around crops (default 10)

    Returns JSON:
    {
      "pages": [
        {
          "pageNum": 1,
          "width": 1654,
          "height": 2339,
          "fullPageUrl": "/data/images/quiz/{quiz_id}_page1.png",
          "crops": [
            {
              "type": "figure",
              "confidence": 0.93,
              "bbox": { "x1": 906, "y1": 1806, "x2": 1385, "y2": 2048, ... },
              "imageUrl": "/data/images/quiz/{quiz_id}_p1_fig0.png",
              "filename": "{quiz_id}_p1_fig0.png"
            }
          ]
        }
      ],
      "allCrops": [...],
      "timing_ms": 2500
    }
    """
    start = time.time()

    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded. Use multipart field "file"'}), 400

    quiz_id = request.args.get('quiz_id') or request.form.get('quiz_id')
    if not quiz_id:
        return jsonify({'error': 'quiz_id is required'}), 400

    file = request.files['file']
    file_bytes = file.read()
    filename = file.filename or 'unknown'
    mime = file.content_type or ''

    conf = float(request.args.get('conf', CONF_THRESHOLD))
    padding = int(request.args.get('padding', 10))
    type_filter = request.args.get('types', 'figure,table').strip()
    crop_types = [t.strip() for t in type_filter.split(',') if t.strip()]

    model = get_model()

    # Convert to page images
    if mime == 'application/pdf' or filename.lower().endswith('.pdf'):
        pages = pdf_to_images(file_bytes)
    else:
        pages = load_image(file_bytes)

    result_pages = []
    all_crops = []

    for page in pages:
        pn = page['pageNum']
        pil_img = page['image']

        # Save full page image
        page_filename = f'{quiz_id}_page{pn}.png'
        page_path = os.path.join(CROP_DIR, page_filename)
        pil_img.save(page_path, 'PNG')
        page_url = f'/data/images/quiz/{page_filename}'

        # Detect regions
        regions = detect_page_layout(model, pil_img, conf=conf)

        # Filter to crop types and crop
        crops = []
        type_counters = {}

        for region in regions:
            rtype = region['type']
            if rtype not in crop_types:
                continue

            # Counter per type for naming
            type_counters[rtype] = type_counters.get(rtype, 0)
            idx = type_counters[rtype]
            type_counters[rtype] += 1

            # Type prefix for filename
            prefix = 'fig' if rtype == 'figure' else 'tbl' if rtype == 'table' else rtype[:3]
            crop_filename = f'{quiz_id}_p{pn}_{prefix}{idx}.png'
            crop_path = os.path.join(CROP_DIR, crop_filename)
            crop_url = f'/data/images/quiz/{crop_filename}'

            # Crop and save
            cropped_img = crop_region(pil_img, region['bbox'], padding=padding)
            cropped_img.save(crop_path, 'PNG')

            crop_entry = {
                'type': rtype,
                'confidence': region['confidence'],
                'bbox': region['bbox'],
                'imageUrl': crop_url,
                'filename': crop_filename,
                'cropSize': {'width': cropped_img.width, 'height': cropped_img.height},
                'pageNum': pn,
            }
            crops.append(crop_entry)
            all_crops.append(crop_entry)

            print(f'[layout] Cropped {rtype} #{idx} on page {pn}: '
                  f'{region["bbox"]["width"]}x{region["bbox"]["height"]} '
                  f'conf={region["confidence"]} → {crop_filename}')

        result_pages.append({
            'pageNum': pn,
            'width': page['width'],
            'height': page['height'],
            'fullPageUrl': page_url,
            'crops': crops,
        })

    elapsed = round((time.time() - start) * 1000)

    return jsonify({
        'pages': result_pages,
        'allCrops': all_crops,
        'timing_ms': elapsed,
    })


# ── Extract sub-figures from table crops ──────────────────────────────────────
def extract_subfigures_from_table(pil_image):
    """
    Find bordered diagram boxes in a table crop image using contour detection.
    Detects thick-bordered regions in the top half of the table (e.g. conversion
    arrow diagrams, reference charts) and returns their bounding boxes.
    """
    import numpy as np
    import cv2

    img_np = np.array(pil_image.convert('L'))  # grayscale
    h, w = img_np.shape
    total_area = w * h

    # Binary threshold — find dark borders/lines
    _, binary = cv2.threshold(img_np, 150, 255, cv2.THRESH_BINARY_INV)

    # Find all contours (nested — RETR_TREE finds boxes within the table)
    contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        area = cw * ch
        ratio = area / total_area

        # Must be: top half, significant but not the whole image, box-shaped
        if ratio < 0.08 or ratio > 0.35:
            continue
        if y > h * 0.5:
            continue
        if ch < 100 or cw < 200:
            continue
        aspect = cw / max(ch, 1)
        if aspect < 0.8 or aspect > 4:
            continue

        candidates.append({
            'x1': x, 'y1': y, 'x2': x + cw, 'y2': y + ch,
            'width': cw, 'height': ch, 'area': area,
        })

    # Deduplicate — keep largest non-overlapping boxes
    candidates.sort(key=lambda b: b['area'], reverse=True)
    keep = []
    for c in candidates:
        overlaps = False
        for k in keep:
            ix1 = max(c['x1'], k['x1'])
            iy1 = max(c['y1'], k['y1'])
            ix2 = min(c['x2'], k['x2'])
            iy2 = min(c['y2'], k['y2'])
            if ix1 < ix2 and iy1 < iy2:
                inter = (ix2 - ix1) * (iy2 - iy1)
                smaller = min(c['area'], k['area'])
                if inter / smaller > 0.5:
                    overlaps = True
                    break
        if not overlaps:
            keep.append(c)

    # Sort left-to-right
    keep.sort(key=lambda b: b['x1'])
    return keep


def extract_icon_column(pil_image):
    """
    Find a vertical stack of small square-ish icons (e.g. a picture-matching
    worksheet: fruit/animal/object icons stacked in one column, one per row/word).
    The wide-diagram detector above only looks at the top half and requires a
    wide aspect ratio, so it misses this shape entirely — every icon fell
    through to the single "shared full-page" fallback, showing the same
    uncropped page for every matching option instead of one icon each.
    """
    import numpy as np
    import cv2

    img_np = np.array(pil_image.convert('L'))
    h, w = img_np.shape
    total_area = w * h

    _, binary = cv2.threshold(img_np, 150, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    icons = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        area = cw * ch
        ratio = area / total_area
        # Small, roughly square-ish icon — not a full diagram, not a text line
        if ratio < 0.002 or ratio > 0.06:
            continue
        aspect = cw / max(ch, 1)
        if aspect < 0.4 or aspect > 2.5:
            continue
        if cw < 20 or ch < 20:
            continue
        icons.append({'x1': x, 'y1': y, 'x2': x + cw, 'y2': y + ch, 'width': cw, 'height': ch, 'area': area})

    if len(icons) < 2:
        return []

    # Dedupe nested/overlapping contours (same icon detected at multiple contour levels)
    icons.sort(key=lambda b: b['area'], reverse=True)
    keep = []
    for c in icons:
        overlaps = False
        for k in keep:
            ix1, iy1 = max(c['x1'], k['x1']), max(c['y1'], k['y1'])
            ix2, iy2 = min(c['x2'], k['x2']), min(c['y2'], k['y2'])
            if ix1 < ix2 and iy1 < iy2:
                inter = (ix2 - ix1) * (iy2 - iy1)
                if inter / min(c['area'], k['area']) > 0.4:
                    overlaps = True
                    break
        if not overlaps:
            keep.append(c)

    if len(keep) < 2:
        return []

    # Must form a column: centers roughly share the same x, spread down the page
    centers_x = [(k['x1'] + k['x2']) / 2 for k in keep]
    mean_x = sum(centers_x) / len(centers_x)
    max_dev = max(abs(cx - mean_x) for cx in centers_x)
    if max_dev > w * 0.18:
        return []  # not aligned into one column — bail rather than guess

    keep.sort(key=lambda b: b['y1'])
    return keep


@app.route('/extract-subfigures', methods=['POST'])
def extract_subfigures():
    """
    Extract sub-figure regions (bordered diagram boxes) from a table crop image.
    Used when ML detects a table but Gemini says it contains diagrams.

    Accepts: multipart file upload (field: 'file') — a cropped table image
    Query params:
      - quiz_id: for naming output files (required)
      - prefix: filename prefix (default: 'subfig')
      - padding: px padding around subfigures (default: 5)

    Returns JSON with detected subfigure crops.
    """
    start = time.time()

    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    quiz_id = request.args.get('quiz_id') or request.form.get('quiz_id')
    if not quiz_id:
        return jsonify({'error': 'quiz_id is required'}), 400

    prefix = request.args.get('prefix', 'subfig')
    padding = int(request.args.get('padding', 5))

    file = request.files['file']
    file_bytes = file.read()
    pil_img = Image.open(BytesIO(file_bytes)).convert('RGB')

    # Detect sub-figure boxes — wide top-half diagrams first (arrow charts, etc.),
    # then a vertical icon-column pattern (picture-matching worksheets) if that
    # finds nothing, so both worksheet shapes get real per-item crops instead of
    # falling through to the single "shared whole page" fallback.
    try:
        subfigures = extract_subfigures_from_table(pil_img)
        if not subfigures:
            subfigures = extract_icon_column(pil_img)
    except Exception as e:
        # If cv2 not available, try simple top-half split
        print(f'[layout] cv2 subfigure detection failed: {e}, using heuristic split')
        subfigures = []

    crops = []

    if subfigures:
        # Crop and save each subfigure
        for i, bbox in enumerate(subfigures):
            crop_filename = f'{quiz_id}_{prefix}{i}.png'
            crop_path = os.path.join(CROP_DIR, crop_filename)
            crop_url = f'/data/images/quiz/{crop_filename}'

            cropped = crop_region(pil_img, bbox, padding=padding)
            cropped.save(crop_path, 'PNG')

            crops.append({
                'type': 'figure',
                'bbox': bbox,
                'imageUrl': crop_url,
                'filename': crop_filename,
                'cropSize': {'width': cropped.width, 'height': cropped.height},
            })
            print(f'[layout] Subfigure #{i}: {bbox["width"]}x{bbox["height"]} -> {crop_filename}')
    else:
        # Heuristic fallback: split top portion into left/right halves
        w, h = pil_img.size
        top_h = int(h * 0.45)  # top 45% where diagrams usually sit
        mid_x = w // 2

        for i, (x1, x2) in enumerate([(0, mid_x), (mid_x, w)]):
            crop_filename = f'{quiz_id}_{prefix}{i}.png'
            crop_path = os.path.join(CROP_DIR, crop_filename)
            crop_url = f'/data/images/quiz/{crop_filename}'

            cropped = pil_img.crop((x1, 0, x2, top_h))
            cropped.save(crop_path, 'PNG')

            crops.append({
                'type': 'figure',
                'bbox': {'x1': x1, 'y1': 0, 'x2': x2, 'y2': top_h, 'width': x2 - x1, 'height': top_h},
                'imageUrl': crop_url,
                'filename': crop_filename,
                'cropSize': {'width': cropped.width, 'height': cropped.height},
            })
            print(f'[layout] Heuristic split #{i}: {x2-x1}x{top_h} -> {crop_filename}')

    elapsed = round((time.time() - start) * 1000)

    return jsonify({
        'subfigures': crops,
        'method': 'contour' if subfigures else 'heuristic_split',
        'timing_ms': elapsed,
    })


# ── Blank-region detection (OpenCV) ──────────────────────────────────────────
# Finds every place a student writes an answer: empty boxes, empty table cells,
# and underline/fill-in blanks. Returns precise NORMALIZED coordinates (0..1) so
# the frontend can overlay input fields on top of the worksheet image — this is
# what makes ANY layout (pyramid, clock, table, number line) interactive.
def detect_blanks_in_image(pil_image, min_box_frac=0.012, max_box_frac=0.9,
                           empty_thresh=0.045, detect_lines=True):
    import numpy as np
    import cv2

    rgb = np.array(pil_image.convert('RGB'))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    H, W = gray.shape

    # Ink mask: dark pixels -> 255
    ink = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)[1]

    blanks = []

    # ── Pass 1: boxed cells / blocks (tables, pyramid blocks, answer boxes) ──
    hlen = max(12, W // 35)
    vlen = max(12, H // 45)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (hlen, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vlen))
    horizontal = cv2.dilate(cv2.erode(ink, h_kernel), h_kernel)
    vertical = cv2.dilate(cv2.erode(ink, v_kernel), v_kernel)
    grid = cv2.add(horizontal, vertical)
    grid = cv2.dilate(grid, np.ones((3, 3), np.uint8), iterations=1)

    contours, hierarchy = cv2.findContours(grid, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    min_w, min_h = W * min_box_frac * 1.4, H * min_box_frac

    def is_cell_empty(inner):
        """A cell is empty only if it has near-zero ink AND no real text glyphs.
        Raw ink density alone misfires on large cells with brief text (e.g. '19:00'),
        so we also count connected components (letter/digit strokes) as the deciding signal."""
        if inner.size == 0:
            return False, 0.0, 0
        density = float(inner.mean()) / 255.0
        n_labels, _, stats, _ = cv2.connectedComponentsWithStats((inner > 0).astype(np.uint8), connectivity=8)
        # component 0 is background; count "real" ink blobs (filters 1-2px noise specks)
        components = sum(1 for s in stats[1:] if s[cv2.CC_STAT_AREA] >= 3)
        if components >= 3:
            return False, density, components   # clearly has text (3+ strokes/glyph parts)
        if components == 0:
            return True, density, components    # nothing at all
        return density <= empty_thresh, density, components  # 1-2 marks: fall back to density

    raw_boxes = []
    for i, c in enumerate(contours):
        # inner cells (holes) have a parent in CCOMP hierarchy
        parent = hierarchy[0][i][3]
        if parent == -1:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        if cw < min_w or ch < min_h:
            continue
        if cw > W * max_box_frac and ch > H * max_box_frac:
            continue
        ar = cw / float(ch)
        if ar < 0.15 or ar > 25:
            continue
        # Emptiness check, shrunk inward to avoid the border lines themselves
        mx = int(cw * 0.14) + 3
        my = int(ch * 0.14) + 3
        inner = ink[y + my:y + ch - my, x + mx:x + cw - mx]
        empty, density, _ = is_cell_empty(inner)
        if empty:
            raw_boxes.append({'type': 'box', 'x': x, 'y': y, 'w': cw, 'h': ch, 'density': round(density, 3)})

    # ── Split merged/borderless blank rows using the vertical-line mask ──
    # Some table rows have no internal column dividers drawn for the blank row itself
    # (Word often renders it as one wide cell). If vertical divider ink crosses that
    # row's height (even without forming a closed box), split at those x-positions —
    # this recovers the true per-column cells (e.g. Time/24hr/12hr/Clock) generically.
    wide_frac = 0.35
    for b in raw_boxes:
        if b['w'] < W * wide_frac:
            blanks.append(b)
            continue
        y0, y1 = b['y'], b['y'] + b['h']
        col_mask = vertical[y0:y1, b['x']:b['x'] + b['w']]
        if col_mask.size == 0:
            blanks.append(b)
            continue
        col_presence = (col_mask > 0).mean(axis=0)  # fraction of row-height covered, per x
        xs = np.where(col_presence > 0.55)[0]
        # cluster consecutive x's into divider positions
        dividers = []
        if len(xs):
            run = [xs[0]]
            for xv in xs[1:]:
                if xv - run[-1] <= 3:
                    run.append(xv)
                else:
                    dividers.append(int(np.mean(run))); run = [xv]
            dividers.append(int(np.mean(run)))
        # drop dividers too close to the box's own edges
        dividers = [d for d in dividers if 6 < d < b['w'] - 6]
        if len(dividers) >= 1:
            edges = [0] + dividers + [b['w']]
            for k in range(len(edges) - 1):
                sx, ex = edges[k], edges[k + 1]
                sub_w = ex - sx
                if sub_w < min_w:
                    continue
                sub = {'type': 'box', 'x': b['x'] + sx, 'y': b['y'], 'w': sub_w, 'h': b['h'], 'density': b['density']}
                blanks.append(sub)
        else:
            blanks.append(b)

    # ── Pass 2: underline / fill-in blanks (a horizontal rule with space above) ──
    if detect_lines:
        line_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(30, W // 18), 1))
        only_h = cv2.dilate(cv2.erode(ink, line_kernel), line_kernel)
        lc, _ = cv2.findContours(only_h, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        box_rects = [(b['x'], b['y'], b['w'], b['h']) for b in blanks]
        for c in lc:
            x, y, lw, lh = cv2.boundingRect(c)
            if lw < W * 0.05 or lh > max(4, H // 200):  # must be long & thin
                continue
            # skip lines that belong to a detected box (table borders)
            inside_box = any(x >= bx - 5 and x + lw <= bx + bw + 5 and by - 5 <= y <= by + bh + 5
                             for (bx, by, bw, bh) in box_rects)
            if inside_box:
                continue
            # region above the line should be mostly empty (writing space)
            band_h = max(18, int(lh * 6), H // 45)
            top = max(0, y - band_h)
            above = ink[top:y, x:x + lw]
            if above.size == 0:
                continue
            if float(above.mean()) / 255.0 <= empty_thresh * 2.2:
                blanks.append({'type': 'line', 'x': x, 'y': top, 'w': lw, 'h': y - top, 'density': 0.0})

    # ── Dedupe: drop boxes fully containing other boxes (keep innermost cells) ──
    def contains(a, b):
        return (a['x'] <= b['x'] + 2 and a['y'] <= b['y'] + 2 and
                a['x'] + a['w'] >= b['x'] + b['w'] - 2 and a['y'] + a['h'] >= b['y'] + b['h'] - 2 and
                (a['w'] * a['h']) > (b['w'] * b['h']) * 1.15)
    kept = []
    for b in blanks:
        if any(contains(b, other) for other in blanks if other is not b):
            continue  # b is an outer container of a smaller cell -> drop
        kept.append(b)

    # Sort reading order (top-to-bottom, then left-to-right, row-banded)
    kept.sort(key=lambda b: (round(b['y'] / max(1, H * 0.03)), b['x']))

    # Normalize
    out = []
    for b in kept:
        out.append({
            'type': b['type'],
            'x': round(b['x'] / W, 4), 'y': round(b['y'] / H, 4),
            'w': round(b['w'] / W, 4), 'h': round(b['h'] / H, 4),
            'density': b['density'],
        })
    return out, (W, H)


@app.route('/detect-blanks', methods=['POST'])
def detect_blanks():
    """
    Detect blank answer regions (boxes, table cells, underlines) on a worksheet.

    Accepts: multipart file (field 'file') — PDF or image.
    Query: quiz_id (optional, for debug image naming), debug=1 to save annotated image.
    Returns: { pages: [{ pageNum, width, height, imageUrl, blanks: [{type,x,y,w,h}] }] }
             coordinates are normalized 0..1 (relative to the page image).
    """
    import cv2
    import numpy as np
    start = time.time()
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    quiz_id = request.args.get('quiz_id') or request.form.get('quiz_id') or 'blanks'
    debug = request.args.get('debug', '1') != '0'
    file = request.files['file']
    data = file.read()
    is_pdf = (file.filename or '').lower().endswith('.pdf') or data[:4] == b'%PDF'

    pages_src = pdf_to_images(data) if is_pdf else load_image(data)

    pages_out = []
    for pg in pages_src:
        img = pg['image']
        blanks, (W, Hh) = detect_blanks_in_image(img)

        # Save the full page image so the frontend can overlay on it
        page_fname = f'{quiz_id}_page{pg["pageNum"]}.png'
        img.save(os.path.join(CROP_DIR, page_fname), 'PNG')
        page_url = f'/data/images/quiz/{page_fname}'

        debug_url = None
        if debug:
            dbg = np.array(img.convert('RGB')).copy()
            for b in blanks:
                x, y = int(b['x'] * W), int(b['y'] * Hh)
                w, h = int(b['w'] * W), int(b['h'] * Hh)
                color = (0, 170, 90) if b['type'] == 'box' else (200, 90, 200)
                cv2.rectangle(dbg, (x, y), (x + w, y + h), color, 3)
            dbg_fname = f'{quiz_id}_blanks_p{pg["pageNum"]}.png'
            Image.fromarray(dbg).save(os.path.join(CROP_DIR, dbg_fname), 'PNG')
            debug_url = f'/data/images/quiz/{dbg_fname}'

        pages_out.append({
            'pageNum': pg['pageNum'], 'width': W, 'height': Hh,
            'imageUrl': page_url, 'debugUrl': debug_url,
            'blanks': blanks, 'blankCount': len(blanks),
        })
        print(f'[layout] /detect-blanks page {pg["pageNum"]}: {len(blanks)} blanks')

    return jsonify({'pages': pages_out, 'timing_ms': round((time.time() - start) * 1000)})


# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print(f'[layout] Aivorah Layout Detection Service')
    print(f'[layout] Port: {PORT} | DPI: {DPI} | Conf: {CONF_THRESHOLD} | ImgSize: {IMG_SIZE}')
    print(f'[layout] Crop dir: {os.path.abspath(CROP_DIR)}')

    # Eagerly warm the model in a background thread so the FIRST real /detect or /crop
    # request never pays the cold-load cost (previously: whichever quiz generation
    # happened to be first would stall for minutes waiting on model load). Runs in a
    # thread rather than blocking here so /health responds immediately either way.
    def _warm_model():
        t0 = time.time()
        try:
            get_model()
            print(f'[layout] Warm-up complete in {time.time() - t0:.1f}s — model ready for requests')
        except Exception as e:
            print(f'[layout] Warm-up failed ({e}) — will retry lazily on first request')
    threading.Thread(target=_warm_model, daemon=True).start()
    print('[layout] Ready! (warming ML model in background)')

    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
