# WebBBS — 巴哈姆特 BBS 網頁客戶端

A browser client for the 巴哈姆特 (Bahamut) BBS at `term.gamer.com.tw` that renders each
BBS screen as a **native web page** instead of a raw terminal.

The BBS is still an 80×24 Big5/ANSI telnet-style application. A hidden
[xterm.js](https://xtermjs.org/) instance is used purely as a screen buffer: raw Big5
frames are decoded, parsed into a typed page model, and React renders that model as
modern HTML. Reading and navigation are fully supported; **replying** is supported
through a native composer that drives the BBS post wizard.

> Detailed design notes live in [`web/README.md`](web/README.md).

---

## Features

| BBS screen | Native rendering |
| --- | --- |
| 主功能表 | clickable menu list with hotkey badges |
| 看板列表 | searchable table (`#`, 看板, 狀態, 說明, 板主) with a 進入 button per row |
| 文章列表 | table (`#`, 編號, 標記, 日期, 作者, 標題) with title/author filter and a 閱讀 button per row |
| 文章內容 | article reader (title, 作者/看板/時間, quoted body); 首篇 / 上一篇 / 下一篇, **串接閱讀全部** (walks a whole thread into one page), and **✎ 回覆** |
| 系統公告 / 進板畫面 | notice / text reading pane |
| 勇者代號 / 密碼 | login form (credentials kept in memory only, never persisted) |

- Each screen exposes the function keys printed by the BBS as a bottom **action bar**.
- Keyboard navigation: arrows, Enter, PageUp/Down, Home/End, `q`.
- **Auto-reconnect** (~3s) with re-login after an unexpected disconnect; a "Raw terminal"
  toggle shows the underlying 80×24 screen for debugging.
- Mobile-aware layout (viewport sizing, bottom-sheet settings, scrollable keybar).

## Architecture

```
BBS wss ──Big5 bytes──▶ ws-proxy.mjs (:8080, adds Origin header) ──▶ browser WS
browser: bytes ─▶ stateful Big5 decoder ─▶ hidden xterm (screen buffer)
         ─▶ parseScreen(rows, colors) ─▶ BbsPage model ─▶ React pages
         user action ─▶ BbsActions ─▶ Big5 bytes ─▶ ws-proxy ─▶ BBS
```

- **`ws-proxy.mjs`** (repo root) — a Node/Express service that
  1. relays the browser WebSocket to the BBS, injecting the required
     `Origin: https://term.gamer.com.tw` header the browser cannot set, and
  2. exposes a REST + SQLite cache API.
  It also serves the built web client when `web/dist/` exists (the production/Docker
  single-port mode).
- **`web/`** — the React 19 + TypeScript + Vite frontend. It talks **only** to the
  WebSocket proxy, connecting to the page's own origin in production
  (overridable with `VITE_WS_URL`).
- **`scraper/`** — dev-only tooling for capturing BBS screen fixtures.

## Quick start (Docker)

> Requires Docker with the Compose plugin.

```bash
# build + run on http://localhost:8081
docker compose up -d --build
```

Open **http://localhost:8081**, click **Connect**, then log in on the native form.

The SQLite cache lives in the named volume `webbbs-data` (mounted at `/app/data`).
To stop/remove:

```bash
docker compose down          # keep data
docker compose down -v       # also delete the data volume
```

### Without Compose

```bash
docker build -t webbbs .
docker run --rm -p 8081:8080 -v webbbs-data:/app/data webbbs
```

### Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Container's HTTP + WebSocket listen port (not the published host port) |
| `BBS_USER` | *(empty)* | Only used by the blocked WebSocket crawler — the web client logs in itself |
| `BBS_PASS` | *(empty)* | Same as above |

Only the **container** port (`8080`) is fixed; the published host port is free to change
(the compose default is `8081`, overriding via `HOST_PORT=9090 docker compose up -d`).
The built client connects the WebSocket to the page's own origin, so any host port works.
For a different hostname or a TLS reverse proxy, set `VITE_WS_URL` at build time
(`docker build --build-arg` / a `.env` with `VITE_WS_URL=wss://...`).

## Local development

```bash
# 1. backend proxy + REST API on :8080
node ws-proxy.mjs            # or: node ws-proxy.mjs 9000  (custom port)

# 2. frontend on :5173
cd web
npm install
npm run dev
# or start both at once:
npm run dev:all
```

Open `http://localhost:5173` and connect. In dev the proxy does **not** serve the SPA
(no `web/dist`), so the Vite dev server keeps hot reload.

## REST API

Served by `ws-proxy.mjs` on the same port.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/posts?page=&limit=` | Paginated cached posts (board `chat`) |
| `GET` | `/api/posts/:id` | Single cached post |
| `GET` | `/api/crawler/status` | Crawler status + cached post count |
| `POST` | `/api/crawler/submit-posts` | Save posts decoded by the browser (`{ posts: [...] }`) |
| `GET` | `/api/crawler/scrape` | HTTP scraper for `forum.gamer.com.tw` (bypasses the blocked WS crawler) |
| `POST` | `/api/crawler/crawl` | **410 Gone** — BBS WebSocket crawl is permanently blocked |

## Testing

```bash
cd web
npm run test       # vitest: parser fixtures + page render smoke tests
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```

Parser tests run against real captured screens in `web/src/utils/__fixtures__/`.
Re-capture live screens with `node scraper/capture-fixtures.mjs`, and run end-to-end
live QA (drives the real BBS, screenshots each page) with `node qa-native.mjs`.

## Project structure

```
.
├── ws-proxy.mjs              # WebSocket relay + REST/SQLite API (+ static SPA in prod)
├── Dockerfile                # 3-stage: web build → native deps → slim runtime
├── docker-compose.yml        # one service (host 8081 → container 8080), named data volume
├── data/                     # local SQLite cache (git-ignored; volume in Docker)
├── scraper/                  # dev-only BBS fixture capture tooling
├── qa-native.mjs             # end-to-end live QA harness
└── web/                      # React 19 + Vite + TypeScript client
    └── src/
        ├── utils/bbsScreen.ts   # pure screen parser → BbsPage union
        ├── hooks/useBbsSession.ts
        └── components/bbs/      # one component per BBS page kind
```

## Tech stack

React 19 · TypeScript · Vite · xterm.js (hidden screen buffer) · iconv-lite (Big5) ·
Express · better-sqlite3 · ws.

## Known limitations

- **One session per account.** Bahamut forcibly disconnects an earlier login
  (another tab/device or reconnect). The app auto-answers the
  `刪除其他重複的登入` prompt and reconnects.
- **Posting is public and irreversible.** The reply composer warns before the final
  確認張貼.
- In production the client derives the proxy URL from the page origin (`wss://` when the
  page is HTTPS); set `VITE_WS_URL` to point somewhere else. Only the container port
  `8080` is fixed — publish it on any host port.
- Idle BBS sessions are not timed out — a single authenticated connection stays alive.

## Disclaimer

Unofficial, community-built client. Use it in accordance with 巴哈姆特's terms of
service. Credentials are held in memory only and are never written to disk.
