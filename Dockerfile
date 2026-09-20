# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build the React/Vite web client
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — install runtime dependencies
#   better-sqlite3 is a native addon, so a toolchain is needed as a fallback
#   when no prebuilt binary is available for the target platform.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 3 — slim runtime: WebSocket proxy + REST API + built SPA on one port
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY ws-proxy.mjs ./
COPY --from=web-build /build/web/dist ./web/dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node", "ws-proxy.mjs"]
