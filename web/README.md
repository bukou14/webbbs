# WebBBS - Bahamut BBS Web Client (web-native)

A browser client for 巴哈姆特 BBS (`term.gamer.com.tw`) that renders each BBS screen
as a **native web page** instead of a terminal.

The BBS is still an 80x24 ANSI/Big5 telnet application. A hidden xterm.js instance
is used purely as a screen buffer: raw Big5 frames are decoded, parsed into a typed
page model, and React renders that model as modern HTML. Navigation and reading are
supported (menu, board list, post list, article); posting/replying is out of scope.

## Pages

| BBS screen | Native rendering |
| --- | --- |
| 主功能表 | clickable menu list with hotkey badges |
| 看板列表 | searchable table (`#`, 看板, 狀態, 說明, 板主) with a 進入 button per row |
| 文章列表 | table (`#`, 編號, 標記, 日期, 作者, 標題) with title/author filter and a 閱讀 button per row |
| 文章內容 | article reader (title, 作者/看板/時間, quoted body). 同主題/串接: 首篇 / 上一篇 / 下一篇 (BBS `=` / `-` / `+`), **串接閱讀全部** walks the whole thread across pages into one scrollable page, and **✎ 回覆** opens a native reply composer |
| 系統公告 / 進板畫面 | notice / text reading pane |
| 勇者代號 / 密碼 | login form (credentials are never persisted) |

Each page exposes the function keys printed by the BBS on that screen as a bottom
action bar, and the app supports keyboard navigation (arrows, Enter, PageUp/Down,
Home/End, `q`).

**Replying** (write): the article page's 回覆 composer drives the BBS post wizard
(`y` → 回應至 → 類別 → 標題 → 引用原文 → 簽名檔 → editor), types the body, and saves
with the BBS editor's `^X` → `[S]存檔`. It posts publicly and irreversibly, so the
composer warns before the final 確認張貼.

## Connection resilience

Bahamut allows **one session per account**: a second login (another tab/device, the
official web client, or a reconnect while the old session is still registered) forcibly
disconnects the existing one with `1000 bbs disconnected`. The app auto-answers the
`刪除其他重複的登入` prompt, and on any unexpected disconnect it **auto-reconnects** (~3s),
re-logs in with the credentials entered this session, and reopens the last board.
Credentials are held in memory only (never written to storage); clicking **Disconnect**
stops auto-reconnect.

Idle sessions are *not* timed out by the BBS — verified empirically: a single
authenticated connection stays alive indefinitely with no keepalive.

## Architecture

```
BBS wss ──Big5 bytes──▶ ws-proxy (:8080, relay + Origin header) ──▶ browser WS
browser: bytes ─▶ stateful Big5 decoder ─▶ hidden xterm (screen buffer)
         ─▶ parseScreen(rows, colors) ─▶ BbsPage model ─▶ React pages
         user action ─▶ BbsActions ─▶ Big5 bytes ─▶ ws-proxy ─▶ BBS
```

- `src/utils/bbsScreen.ts` — pure screen parser producing the `BbsPage` union
  (`connecting` / `ko` / `login` / `notice` / `menu` / `boardList` / `postList` /
  `article` / `text` / `unknown`), including the selected row and the function legend.
- `src/hooks/useBbsSession.ts` — owns the WebSocket, the hidden xterm buffer, the
  settle/debounce + hash gate, and the page-aware action API.
- `src/components/bbs/` — `BbsBrowserShell` (toolbar, breadcrumbs, function bar,
  global keyboard) plus one component per page kind.
- `ws-proxy.mjs` (repo root) — WebSocket relay that adds the required
  `Origin: https://term.gamer.com.tw` header, plus a REST/SQLite read-only cache.

## Setup

```bash
# from the repo root: WebSocket proxy + REST API
node ws-proxy.mjs            # :8080

# from web/
npm install
npm run dev                  # :5173
# or run both: npm run dev:all
```

Open `http://localhost:5173`, click **Connect**, then log in on the native form.
A "Raw terminal" toggle shows the underlying 80x24 screen for debugging.

## Testing

```bash
cd web
npm run test       # vitest: parser fixtures + page render smoke tests
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```

Parser tests run against real captured BBS screens in
`src/utils/__fixtures__/`. To re-capture live screens:

```bash
node scraper/capture-fixtures.mjs   # writes scraper/fixtures/*.txt|json
```

End-to-end live QA (drives the real BBS and screenshots each page):

```bash
node qa-native.mjs   # writes qa-native/*.png
```

## Tech Stack

React 19, TypeScript, Vite, xterm.js (hidden screen buffer), iconv-lite (Big5),
Express + better-sqlite3 + ws (proxy/API).
