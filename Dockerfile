# ─── Stage 1: Build Expo Web Frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /frontend

COPY AIMentorApp/package*.json ./
RUN npm ci --legacy-peer-deps

COPY AIMentorApp/ ./
RUN npx expo export --platform web --output-dir dist2

# ─── Stage 2: Production Server ───────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Skip Chromium download — puppeteer only used in local scripts, not server routes
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production
ENV PORT=8080

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server code
COPY server/ ./server/

# Copy built frontend from Stage 1
# server/index.js serves from path.join(__dirname, '../AIMentorApp/dist2')
COPY --from=frontend /frontend/dist2 ./AIMentorApp/dist2

EXPOSE 8080

WORKDIR /app/server
CMD ["node", "index.js"]
