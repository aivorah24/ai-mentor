"""
Test DocLayout-YOLO detection on sample worksheets.
Run: python test_worksheets.py
"""

import os
import sys
import time
import json
from pathlib import Path

import fitz
from PIL import Image

# Add parent to path
sys.path.insert(0, os.path.dirname(__file__))

SAMPLES_DIR = r'C:\Users\Asus\Desktop\Aivorah Documents\Assignment Picture'
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'test_output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Model path
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
MODEL_FILE = 'doclayout_yolo_docstructbench_imgsz1024.pt'


def find_model():
    for root, dirs, files in os.walk(MODEL_DIR):
        for f in files:
            if f == MODEL_FILE:
                return os.path.join(root, f)
    return None


def test_worksheets():
    from doclayout_yolo import YOLOv10

    model_path = find_model()
    if not model_path:
        print('ERROR: Model not found. Run layout_service.py first to download.')
        return

    print(f'Loading model from: {model_path}')
    model = YOLOv10(model_path)
    print(f'Classes: {model.names}\n')

    # Test PDFs
    test_files = [
        'Toddle-8d6af58a-a488-46a7-93fb-f0a5ec0611cc-PYP4 -MHLE-32.pdf',  # Area & Perimeter (has shapes)
        'Toddle-18d1b2d2-239c-414a-8d82-142053d025d3-Revised PYP4 -MHLE-29.pdf',  # Math
        'Toddle-37228a95-e9c6-4551-9292-5a910e1e053f-PYP4 -MHLE-31.pdf',  # Math
        'Toddle-c0b2c531-b382-4272-90ac-77df87287b76-Charlotte\'s Web - Choiceboard.pdf',  # English
        'Toddle-1da50398-6c5e-4957-a81b-0f042c95930f-PYP4 MHLE-12.pdf',  # Math
        'Toddle-0005707c-9d35-4c61-aea0-3a43d671b0f1-PYP 2 - MHLE 22 1.pdf',  # PYP2 Math
        'Toddle-2ecb0662-c7df-4d0b-8590-c13c0faf7542-raz_ln16_forceofwater_clr.pdf',  # Science
    ]

    import numpy as np

    for filename in test_files:
        filepath = os.path.join(SAMPLES_DIR, filename)
        if not os.path.exists(filepath):
            print(f'SKIP: {filename} not found')
            continue

        short_name = filename.split('-')[-1].strip() if '-' in filename else filename
        print(f'{"=" * 60}')
        print(f'FILE: {short_name}')

        doc = fitz.open(filepath)
        total_figures = 0
        total_tables = 0

        for page_idx in range(min(doc.page_count, 3)):  # First 3 pages max
            page = doc[page_idx]
            pix = page.get_pixmap(dpi=200)
            img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            img_np = np.array(img)

            start = time.time()
            results = model.predict(img_np, imgsz=1024, conf=0.25, verbose=False)
            elapsed = round((time.time() - start) * 1000)

            print(f'\n  Page {page_idx + 1} ({pix.width}x{pix.height}) — {elapsed}ms:')

            page_figures = []
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    cls_name = model.names[cls_id]
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
                    w, h = x2 - x1, y2 - y1

                    marker = ''
                    if cls_name == 'figure':
                        marker = ' ★ FIGURE'
                        total_figures += 1
                        page_figures.append((x1, y1, x2, y2, conf))
                    elif cls_name == 'table':
                        marker = ' ★ TABLE'
                        total_tables += 1

                    print(f'    {cls_name:15s}  conf={conf:.2f}  [{x1:4d},{y1:4d} → {x2:4d},{y2:4d}]  {w}x{h}{marker}')

            # Save cropped figures for this page
            for i, (x1, y1, x2, y2, conf) in enumerate(page_figures):
                pad = 10
                crop = img.crop((
                    max(0, x1 - pad), max(0, y1 - pad),
                    min(pix.width, x2 + pad), min(pix.height, y2 + pad)
                ))
                safe_name = short_name.replace('.pdf', '').replace(' ', '_')
                crop_path = os.path.join(OUTPUT_DIR, f'{safe_name}_p{page_idx+1}_fig{i}.png')
                crop.save(crop_path)
                print(f'    → Saved: {os.path.basename(crop_path)}')

        doc.close()
        print(f'\n  TOTAL: {total_figures} figures, {total_tables} tables\n')


if __name__ == '__main__':
    test_worksheets()
