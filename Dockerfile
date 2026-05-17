# ─── Production Server ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Skip Chromium download — puppeteer only used in local scripts, not server routes
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production
ENV PORT=8080

# ── Install Python 3 + pip for ML layout service ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

# ── Python ML dependencies (DocLayout-YOLO for figure/table detection) ──
COPY server/python/requirements.txt /tmp/py-requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/py-requirements.txt

# ── Copy ML service code ──
COPY server/python/layout_service.py ./server/python/layout_service.py

# ── Download ML model at build time (~39MB, cached in Docker layer) ──
RUN python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download('juliozhao/DocLayout-YOLO-DocStructBench', 'doclayout_yolo_docstructbench_imgsz1024.pt', cache_dir='/app/server/python/models')"

# ── Install Node.js server dependencies ──
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server code
COPY server/ ./server/

# Copy pre-built frontend (built locally via: npx expo export --platform web --output-dir dist2)
# server/index.js serves from path.join(__dirname, '../AIMentorApp/dist2')
COPY AIMentorApp/dist2/_expo        ./AIMentorApp/dist2/_expo
COPY AIMentorApp/dist2/index.html   ./AIMentorApp/dist2/index.html
COPY AIMentorApp/dist2/favicon.ico  ./AIMentorApp/dist2/favicon.ico
COPY AIMentorApp/dist2/metadata.json ./AIMentorApp/dist2/metadata.json
# Copy font assets explicitly — avoids .dockerignore node_modules exclusion
COPY AIMentorApp/dist2/assets       ./AIMentorApp/dist2/assets

# ── Copy startup script ──
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8080

# ML layout service runs on localhost:5050 inside the container
ENV LAYOUT_SERVICE_URL=http://localhost:5050
ENV LAYOUT_PORT=5050

WORKDIR /app/server
CMD ["/app/start.sh"]
