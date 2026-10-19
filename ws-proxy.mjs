/**
 * WebSocket proxy for bbs.gamer.com.tw + REST API + BBS Crawler
 * 
 * Browser can't set Origin header on WebSocket connections.
 * This proxy sits between the browser and the BBS, adding the required
 * Origin: https://term.gamer.com.tw header.
 * 
 * Usage: node ws-proxy.mjs [port]
 * Default port: 8080
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import iconv from 'iconv-lite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Minimal `.env` loader (no dependency). Real environment values always win, and
// `.env` is git-ignored, so credentials never enter the repo.
{
  const envPath = join(__dirname, '.env');
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
const BBS_URL = process.env.BBS_URL || 'wss://term.gamer.com.tw/bbs';
const BBS_ORIGIN = 'https://term.gamer.com.tw';
const BBS_USER = process.env.BBS_USER || '';
const BBS_PASS = process.env.BBS_PASS || '';

// Ensure data directory exists
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

// Initialize SQLite database
const db = new Database(join(dataDir, 'webbbs.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postno TEXT NOT NULL,
    board TEXT NOT NULL DEFAULT 'chat',
    title TEXT,
    author TEXT,
    date TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(postno, board)
  );
  CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board);
  CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date);
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Small key/value store (e.g. last successful scrape timestamp).
const setMeta = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');

// Fingerprint columns for the reuse guard: the opening post's creation time and its
// post id (`cfN`). `snA` is an append-only serial in practice, but if the site ever
// reuses one, the creation time tells a genuinely different thread apart from an edit.
//
// `subject` is the thread topic. The BBS prefixes replies (`Re: X`, `Re X`, `=> X`),
// so stripping that prefix groups a post with the rest of its 同主題 thread — which is
// what the client's 串接 uses. `mark` is the board-list marker (`m` = 板主標記).

/** Thread subject of a BBS title: strip the reply/marker prefix, repeatedly. */
function subjectOf(title) {
  let subject = (title || '').trim();
  for (let i = 0; i < 3; i += 1) {
    const next = subject
      .replace(/^(?:Re|R|Fw)\s*[:：]\s*/i, '') // `Re: X` / `R：X`
      .replace(/^(?:=>|Re|R|Fw)\s+/i, '') // `=> X` / `Re X`
      .trim();
    if (next === subject) break;
    subject = next;
  }
  return subject;
}

// The trailing number of a postno is the board article id (`bbs_chat_62966` -> 62966,
// legacy `chat_1234` -> 1234). Article ids grow with posting time, so it orders a thread.
function articleIdOf(postno) {
  const match = /(\d+)\s*$/.exec(postno || '');
  return match ? Number(match[1]) : 0;
}

function postedAtOf(date) {
  const timestamp = Date.parse(date || '');
  return Number.isNaN(timestamp) ? null : timestamp;
}

function monthDayOf(date) {
  const boardDate = /^(\d{1,2})\/(\d{1,2})/.exec(date || '');
  if (boardDate) return `${Number(boardDate[1])}/${Number(boardDate[2])}`;
  const timestamp = postedAtOf(date);
  if (timestamp === null) return null;
  const parsed = new Date(timestamp);
  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
}

{
  const cols = new Set(db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name));
  if (!cols.has('first_posted_at')) db.exec('ALTER TABLE posts ADD COLUMN first_posted_at TEXT');
  if (!cols.has('op_post_id')) db.exec('ALTER TABLE posts ADD COLUMN op_post_id INTEGER');
  if (!cols.has('subject')) db.exec('ALTER TABLE posts ADD COLUMN subject TEXT');
  if (!cols.has('mark')) db.exec('ALTER TABLE posts ADD COLUMN mark TEXT');
  if (!cols.has('article_no')) db.exec('ALTER TABLE posts ADD COLUMN article_no INTEGER');
  if (!cols.has('posted_at')) db.exec('ALTER TABLE posts ADD COLUMN posted_at INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_subject ON posts(board, subject)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_article_no ON posts(board, article_no)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(board, posted_at)');

  // Backfill the subject for rows written before the column existed.
  const pending = db.prepare('SELECT id, title FROM posts WHERE subject IS NULL').all();
  if (pending.length > 0) {
    const setSubject = db.prepare('UPDATE posts SET subject = ? WHERE id = ?');
    db.transaction((rows) => {
      for (const row of rows) setSubject.run(subjectOf(row.title), row.id);
    })(pending);
    console.log(`[db] backfilled subject for ${pending.length} posts`);
  }

  // `article_no` is the board 編號 promoted to a sortable column: the board list is
  // ordered by it (oldest→newest), so `ORDER BY article_no DESC` is the same list
  // reversed, i.e. the web layout with the newest post first.
  const missingNo = db.prepare('SELECT id, postno FROM posts WHERE article_no IS NULL').all();
  if (missingNo.length > 0) {
    const setNo = db.prepare('UPDATE posts SET article_no = ? WHERE id = ?');
    db.transaction((rows) => {
      for (const row of rows) setNo.run(articleIdOf(row.postno), row.id);
    })(missingNo);
    console.log(`[db] backfilled article_no for ${missingNo.length} posts`);
  }

  const missingPostedAt = db.prepare('SELECT id, date FROM posts WHERE posted_at IS NULL').all();
  if (missingPostedAt.length > 0) {
    const setPostedAt = db.prepare('UPDATE posts SET posted_at = ? WHERE id = ?');
    db.transaction((rows) => {
      for (const row of rows) setPostedAt.run(postedAtOf(row.date), row.id);
    })(missingPostedAt);
    console.log(`[db] backfilled posted_at for ${missingPostedAt.length} posts`);
  }
}

// One-time migration: older rows used postno `chat_<snA>_<tnum>`, where tnum is the
// thread's post count and changes as replies arrive (causing duplicate/stale rows).
// Collapse them to the stable thread id `chat_<snA>`. Idempotent.
{
  const legacy = db
    .prepare("SELECT id, postno FROM posts WHERE board = 'chat'")
    .all()
    .filter((r) => /^chat_\d+_\d+$/.test(r.postno));
  const byPostno = db.prepare('SELECT id, length(content) AS len FROM posts WHERE postno = ? AND board = ?');
  for (const row of legacy) {
    const newPostno = row.postno.replace(/^chat_(\d+)_.*$/, 'chat_$1');
    const dup = byPostno.get(newPostno, 'chat');
    if (!dup) {
      db.prepare('UPDATE posts SET postno = ? WHERE id = ?').run(newPostno, row.id);
    } else {
      // Collision: keep whichever row has the richer content, then drop the other.
      const mine = db.prepare('SELECT length(content) AS len FROM posts WHERE id = ?').get(row.id)?.len || 0;
      if (mine > (dup.len || 0)) {
        db.prepare('UPDATE posts SET content = (SELECT content FROM posts WHERE id = ?) WHERE id = ?').run(row.id, dup.id);
      }
      db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
    }
  }
  if (legacy.length) console.log(`[migrate] postno -> chat_<snA>: ${legacy.length} legacy row(s) processed`);

  // A content cursor pointing at a legacy postno is meaningless after the rename.
  const cur = getMeta.get('content_cursor')?.value;
  if (cur && /^chat_\d+_\d+$/.test(cur)) setMeta.run('content_cursor', '');
}

// Express app for REST API
const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'https://term.gamer.com.tw'] }));
app.use(express.json());

const wss = new WebSocketServer({ noServer: true });

// Shared HTTP server for both WebSocket upgrades and REST API
const server = createServer();

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.on('request', app);

console.log(`[proxy] Listening on ws://localhost:${PORT}`);
console.log(`[proxy] Forwarding to ${BBS_URL} with Origin: ${BBS_ORIGIN}`);

wss.on('connection', (clientWs) => {
  console.log(`[proxy] Client connected`);

  const bbsWs = new WebSocket(BBS_URL, {
    headers: {
      'Origin': BBS_ORIGIN,
    },
  });

  bbsWs.on('open', () => {
    console.log(`[proxy] Connected to BBS`);
    clientWs.send(JSON.stringify({ type: 'connected' }));
  });

  // BBS → Client
  bbsWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  // Client → BBS
  clientWs.on('message', (data, isBinary) => {
    if (bbsWs.readyState === WebSocket.OPEN) {
      bbsWs.send(data, { binary: isBinary });
    }
  });

  bbsWs.on('error', (err) => {
    console.error(`[proxy] BBS error: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, `BBS error: ${err.message}`);
    }
  });

  clientWs.on('error', (err) => {
    console.error(`[proxy] Client error: ${err.message}`);
    if (bbsWs.readyState === WebSocket.OPEN) {
      bbsWs.close(1011, `Client error: ${err.message}`);
    }
  });

  bbsWs.on('close', (code, reason) => {
    console.log(`[proxy] BBS disconnected: ${code} ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      const safeCode = (code === 1006 || code === 1005) ? 1000 : code;
      try { clientWs.close(safeCode, reason); } catch {}
    }
  });

  clientWs.on('close', (code, reason) => {
    console.log(`[proxy] Client disconnected: ${code} ${reason}`);
    if (bbsWs.readyState === WebSocket.OPEN) {
      const safeCode = (code === 1006 || code === 1005) ? 1000 : code;
      try { bbsWs.close(safeCode, reason); } catch {}
    }
  });
});

// Start HTTP server for REST API

// Crawler state
let crawlerState = {
  status: 'idle', // 'idle' | 'running'
  lastCrawl: null,
  postCount: 0,
};

// REST API routes

// GET /api/posts - paginated post list
app.get('/api/posts', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
    const posts = db.prepare(`
      SELECT id, postno, article_no, posted_at, title, author, date, first_posted_at, subject, mark, content, created_at
      FROM posts
      WHERE board = ?
      ORDER BY posted_at DESC NULLS LAST, article_no DESC, id DESC
      LIMIT ? OFFSET ?
    `).all('chat', limit, offset);

    res.json({ posts, total, page, limit });
  } catch (err) {
    console.error('[api] GET /api/posts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/posts/:id - single post
app.get('/api/posts/:id', (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(post);
  } catch (err) {
    console.error('[api] GET /api/posts/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/posts/:id/thread - the whole 同主題 thread this post belongs to, oldest first
app.get('/api/posts/:id/thread', (req, res) => {
  try {
    const post = db.prepare('SELECT id, title, subject FROM posts WHERE id = ?').get(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const subject = post.subject ?? subjectOf(post.title);
    const posts = db
      .prepare(
        `SELECT id, postno, article_no, posted_at, title, author, date, subject, mark, content, created_at
         FROM posts
         WHERE board = 'chat' AND subject = ?`
      )
      .all(subject);
    // 串接 reads a thread the way the board does: oldest article first.
    posts.sort((a, b) => (a.posted_at ?? Infinity) - (b.posted_at ?? Infinity) || a.article_no - b.article_no || a.id - b.id);
    res.json({ subject, posts });
  } catch (err) {
    console.error('[api] GET /api/posts/:id/thread error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crawler/status
app.get('/api/crawler/status', (req, res) => {
  try {
    const postCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
    crawlerState.postCount = postCount;
    res.json({
      status: crawlerState.status,
      lastCrawl: crawlerState.lastCrawl,
      lastCrawlMeta: getMeta.get('last_crawl')?.value ?? null,
      postCount,
    });
  } catch (err) {
    console.error('[api] GET /api/crawler/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crawler/submit-posts - receive posts from browser frontend (which decodes Big5 correctly)
app.post('/api/crawler/submit-posts', (req, res) => {
  try {
    const { posts } = req.body;
    if (!Array.isArray(posts)) {
      return res.status(400).json({ error: 'posts must be an array' });
    }
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO posts (postno, board, title, author, date, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let saved = 0;
    for (const post of posts) {
      try {
        insertStmt.run(post.postno || '', 'chat', post.title || '', post.author || '', post.date || '', post.content || '');
        saved++;
      } catch {}
    }
    const total = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
    crawlerState.lastCrawl = new Date().toISOString();
    res.json({ saved, total });
  } catch (err) {
    console.error('[api] POST /api/crawler/submit-posts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- BBS crawler (term.gamer.com.tw) -----------------------------------------
// A headless 80x24 Big5/ANSI screen drives the real BBS over the same WebSocket the
// browser uses, so it can log in, open board `Chat` (講談說論) and read articles into
// the SQLite cache. Requires BBS_USER / BBS_PASS (see `.env`). One connection is
// logged in and kept open, then reused by every crawl. Bahamut allows one session per
// account, so that single login drops any interactive browser session for the account.

const BBS_TARGET_BOARD = process.env.BBS_BOARD || 'Chat';
const BBS_SCRAPE_ROWS = Math.max(1, Number(process.env.BBS_SCRAPE_ROWS || 6));
const BBS_SYNC_MAX_WINDOWS = Math.max(1, Number(process.env.BBS_SYNC_MAX_WINDOWS || 10000));

function makeBbsScreen(rows = 24, cols = 80) {
  const g = Array.from({ length: rows }, () => Array(cols).fill(' '));
  let r = 0, c = 0;
  const clamp = () => {
    r = Math.max(0, Math.min(rows - 1, r));
    c = Math.max(0, Math.min(cols - 1, c));
  };
  const csi = (cmd, params) => {
    const p = params.split(';').map((x) => (x === '' ? 0 : parseInt(x, 10)));
    switch (cmd) {
      case 'H': case 'f': r = (p[0] || 1) - 1; c = (p[1] || 1) - 1; break;
      case 'A': r -= (p[0] || 1); break;
      case 'B': r += (p[0] || 1); break;
      case 'C': c += (p[0] || 1); break;
      case 'D': c -= (p[0] || 1); break;
      case 'G': c = (p[0] || 1) - 1; break;
      case 'd': r = (p[0] || 1) - 1; break;
      case 'J': if ((p[0] || 0) === 2) { for (const row of g) row.fill(' '); r = 0; c = 0; } break;
      case 'K': {
        const m = p[0] || 0;
        if (m === 0) for (let x = c; x < cols; x++) g[r][x] = ' ';
        else if (m === 2) g[r].fill(' ');
        break;
      }
      default: break;
    }
    clamp();
  };
  return {
    write(text) {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\x1b') {
          const nx = text[i + 1];
          if (nx === '[') {
            let j = i + 2, pr = '';
            while (j < text.length && !/[A-Za-z@]/.test(text[j])) { pr += text[j]; j++; }
            csi(text[j], pr); i = j;
          } else if (nx === '(' || nx === ')' || nx === '#') { i += 2; } else { i += 1; }
          continue;
        }
        if (ch === '\r') { c = 0; continue; }
        if (ch === '\n') { r++; clamp(); continue; }
        if (ch === '\b') { c--; clamp(); continue; }
        if (ch === '\x07' || ch === '\x00') continue;
        if (ch >= ' ') {
          if (r < rows && c < cols) g[r][c] = ch;
          c++;
          if (c >= cols) { c = 0; r++; clamp(); }
        }
      }
    },
    clear() { for (const row of g) row.fill(' '); r = 0; c = 0; },
    text() { return g.map((row) => row.join('').replace(/\s+$/, '')).join('\n'); },
  };
}

// Board list rows: `>62754 +  10/18 rei520   Re 我用網銀轉錢給我媽`
function parseBbsRows(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*>?\s*(\d{4,6})\s+(.*)$/);
    if (!m) continue;
    const rest = m[2];
    const d = rest.match(/(\d{1,2}\/\d{1,2})(?:\/\d{1,2})?/);
    if (!d) continue;
    const before = rest.slice(0, d.index).trim();
    const after = rest.slice(d.index + d[0].length).trim();
    const am = after.match(/^(\S+)\s+(.*)$/);
    if (!am) continue;
    out.push({
      id: String(Number(m[1])),
      mark: before.length === 1 ? before : '',
      date: d[0],
      author: am[1],
      title: am[2].trim(),
    });
  }
  return out;
}

function parseBbsArticle(text) {
  const meta = {};
  const a = text.match(/作者[:：]\s*([^\s(]+)\s*\(([^)]*)\)/);
  if (a) { meta.author = a[1]; meta.nick = a[2]; }
  const b = text.match(/看板[:：]\s*(\S+)/);
  if (b) meta.board = b[1];
  const t = text.match(/標題[:：]\s*(.*)/);
  if (t) meta.title = t[1].trim();
  const tm = text.match(/時間[:：]\s*(.*)/);
  if (tm) meta.time = tm[1].trim();

  // Body = lines after the 時間 header, minus the trailing BBS status bar/footer.
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /時間[:：]/.test(l));
  let bodyLines = start >= 0 ? lines.slice(start + 1) : [];
  bodyLines = bodyLines.filter((l) => !/文章選讀|\(g\)寫得好|Origin:.*BAHAMUT|◆ From:/.test(l));
  while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
  return { meta, body: bodyLines.join('\n') };
}

const upsertBbsPost = db.prepare(`
  INSERT INTO posts (postno, board, title, author, date, content, subject, mark, article_no, posted_at)
  VALUES (?, 'chat', ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(postno, board) DO UPDATE SET
    title = excluded.title,
    author = excluded.author,
    date = excluded.date,
    content = excluded.content,
    subject = excluded.subject,
    mark = excluded.mark,
    article_no = excluded.article_no,
    posted_at = excluded.posted_at
`);

// One long-lived logged-in connection, reused by every crawl (cron + manual), so the
// account logs in once instead of on each tick.
let bbs = null;
const manualSyncState = {
  status: 'idle',
  windows: 0,
  discovered: 0,
  saved: 0,
  skipped: 0,
  stopReason: null,
  error: null,
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const send = (conn, s) => conn.ws.send(iconv.encode(s, 'big5'));
const cur = (conn) => conn.screen.text();

function newBbsConnection() {
  const screen = makeBbsScreen();
  const decoder = iconv.getDecoder('big5');
  const ws = new WebSocket(BBS_URL, { headers: { Origin: BBS_ORIGIN } });
  const conn = { ws, screen, loggedIn: false, closed: false };
  // Buffer frames from before we await: the BBS paints its first screen immediately.
  conn.ready = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.on('message', (d) => {
    const t = decoder.write(Buffer.from(d));
    if (t) screen.write(t);
  });
  ws.on('close', () => { conn.closed = true; conn.loggedIn = false; });
  ws.on('error', () => { conn.closed = true; conn.loggedIn = false; });
  return conn;
}

async function waitFor(conn, sub, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cur(conn).includes(sub)) return true;
    await sleep(200);
  }
  return false;
}

// Answer any key prompt, send id + password, confirm the duplicate login, then skip
// the post-login splash pages.
async function loginBbs(conn) {
  await sleep(3000);
  if (/請按任意鍵/.test(cur(conn))) { send(conn, ' '); await sleep(1000); }
  await waitFor(conn, '請輸入勇者代號', 15000); send(conn, BBS_USER + '\r');
  await waitFor(conn, '請輸入勇者密碼', 12000); send(conn, BBS_PASS + '\r');
  await sleep(2000); send(conn, '\r'); await sleep(1200);
  for (let i = 0; i < 6; i++) { send(conn, ' '); await sleep(700); }
  if (!cur(conn).includes('主功能表')) {
    throw new Error('login failed (no 主功能表); check BBS_USER/BBS_PASS');
  }
  conn.loggedIn = true;
}

async function ensureBbs() {
  if (bbs && !bbs.closed && bbs.ws.readyState === WebSocket.OPEN && bbs.loggedIn) return bbs;
  if (bbs && bbs.ws.readyState === WebSocket.OPEN) {
    try { bbs.ws.close(); } catch {}
  }
  const conn = newBbsConnection();
  await conn.ready;
  await loginBbs(conn);
  bbs = conn;
  console.log('[bbs] logged in; session will be reused by later crawls');
  return conn;
}

// Walk back up to the main menu (← is harmless there), then enter the board afresh so
// the article list reflects posts made since the previous crawl.
async function enterBoard(conn, board) {
  for (let i = 0; i < 6 && !cur(conn).includes('主功能表'); i++) {
    send(conn, '\x1b[D'); await sleep(700);
  }
  send(conn, 's'); await sleep(700);
  send(conn, board); await sleep(700);
  send(conn, '\r'); await sleep(2200);
  if (/請按任意鍵/.test(cur(conn))) { send(conn, ' '); await sleep(1200); }
  if (!cur(conn).includes(`看板《${board}》`)) {
    throw new Error(`could not enter board ${board}`);
  }
}

async function waitForScreenChange(conn, previous, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cur(conn) !== previous) return true;
    await sleep(200);
  }
  return false;
}

async function waitForScreenText(conn, pattern, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pattern.test(cur(conn))) return true;
    await sleep(100);
  }
  return false;
}

async function readSelectedBbsArticle(conn) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await waitForScreenText(conn, /文章選讀/, 1000)) return parseBbsArticle(cur(conn));
    const before = cur(conn);
    send(conn, '\x1b[C');
    await waitForScreenChange(conn, before, 1500);
  }
  throw new Error(`article footer did not load after 200 Right presses; screen=${JSON.stringify(cur(conn).slice(-240))}`);
}

async function returnToBbsBoard(conn, articleId) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (cur(conn).includes('看板《')) return;
    send(conn, '\x1b[D');
    if (await waitForScreenText(conn, /看板《/, 400)) return;
    await waitForScreenChange(conn, cur(conn), 600);
  }
  throw new Error(`could not return to board after article ${articleId}; screen=${JSON.stringify(cur(conn).slice(-320))}`);
}

async function waitForStableScreen(conn, stableMs = 500, timeoutMs = 5000) {
  const startedAt = Date.now();
  let previous = cur(conn);
  let stableSince = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(100);
    const current = cur(conn);
    if (current !== previous) {
      previous = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return true;
    }
  }
  return false;
}

function selectedBbsId(screen) {
  const id = screen.match(/^\s*>\s*(\d{1,6})\s+/m)?.[1];
  return id ? String(Number(id)) : null;
}

function selectedBbsRow(screen, rows) {
  const id = selectedBbsId(screen);
  return id ? rows.find((row) => row.id === id) ?? null : null;
}

function bbsWindowKey(screen) {
  const rows = parseBbsRows(screen);
  return rows.length ? `${rows[0].id}:${rows.at(-1).id}` : '';
}

async function waitForSelectedIdChange(conn, previousId, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (selectedBbsId(cur(conn)) !== previousId) return true;
    await sleep(100);
  }
  return false;
}

async function enterNewestBoardPosition(conn, board) {
  await enterBoard(conn, board);
  if (!(await waitForStableScreen(conn))) {
    throw new Error('board list did not settle after entering the board');
  }
  if (!selectedBbsId(cur(conn))) throw new Error('board list has no selected newest post');
}

async function syncBbsRowsBackward(conn, {
  stopAtCachedWindow = false,
  maxNewPosts = Infinity,
  progress = manualSyncState,
} = {}) {
  let windows = 1;
  let evaluatedWindow = null;

  while (windows <= BBS_SYNC_MAX_WINDOWS) {
    let screen = cur(conn);
    let visible = parseBbsRows(screen);
    let row = selectedBbsRow(screen, visible);
    if (visible.length && !row) {
      await waitForScreenText(conn, /^\s*>\s*\d{1,6}\s+/m, 5000);
      screen = cur(conn);
      visible = parseBbsRows(screen);
      row = selectedBbsRow(screen, visible);
    }
    if (!visible.length) {
      progress.stopReason = 'no-visible-rows';
      console.log(`[sync-all] stopped: no visible rows; screen=${JSON.stringify(screen.slice(0, 320))}`);
      break;
    }
    if (!row) {
      progress.stopReason = 'no-selected-row';
      console.log(`[sync-all] stopped: no selected row; screen=${JSON.stringify(screen.slice(0, 320))}`);
      break;
    }
    const windowKey = visible.map((item) => item.id).join(',');
    if (windowKey !== evaluatedWindow) {
      evaluatedWindow = windowKey;
      const windowUncached = visible.filter((item) => {
        const stored = db.prepare('SELECT date FROM posts WHERE board = ? AND article_no = ?').get('chat', Number(item.id));
        return !stored || monthDayOf(stored.date) !== monthDayOf(item.date);
      });
      if (stopAtCachedWindow && windowUncached.length === 0) {
        progress.stopReason = 'caught-up-window';
        break;
      }
    }

    const cached = db.prepare('SELECT date FROM posts WHERE board = ? AND article_no = ?').get('chat', Number(row.id));
    progress.windows = windows;
    progress.discovered += 1;
    if (!cached || monthDayOf(cached.date) !== monthDayOf(row.date)) {
      try {
        const article = await readSelectedBbsArticle(conn);
        const title = article.meta.title || row.title;
        upsertBbsPost.run(
          `bbs_chat_${row.id}`,
          title,
          article.meta.author || row.author,
          article.meta.time || row.date,
          article.body,
          subjectOf(title),
          row.mark || '',
          Number(row.id),
          postedAtOf(article.meta.time || row.date)
        );
        progress.saved += 1;
      } catch (err) {
        progress.skipped += 1;
        console.warn(`[sync-all] skipping article ${row.id}: ${err.message}; screen=${JSON.stringify(cur(conn).slice(0, 240))}`);
      }
      await returnToBbsBoard(conn, row.id);
      if (progress.saved >= maxNewPosts) {
        progress.stopReason = 'post-limit-reached';
        return progress;
      }
    }

    const beforeUp = selectedBbsId(cur(conn));
    send(conn, '\x1b[A');
    if (await waitForSelectedIdChange(conn, beforeUp, 1200)) continue;

    const beforeWindow = bbsWindowKey(cur(conn));
    const beforeSelected = selectedBbsId(cur(conn));
    let paged = false;
    for (let attempt = 0; attempt < 3 && !paged; attempt += 1) {
      send(conn, '\x1b[5~');
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const current = cur(conn);
        if (bbsWindowKey(current) !== beforeWindow || selectedBbsId(current) !== beforeSelected) {
          paged = true;
          break;
        }
        await sleep(100);
      }
      if (!paged && attempt < 2) await sleep(500);
    }
    if (!paged) {
      progress.stopReason = 'pageup-no-screen-change';
      console.log(`[sync-all] stopped: PageUp did not change window; selected=${beforeSelected} window=${beforeWindow} afterSelected=${selectedBbsId(cur(conn))} afterWindow=${bbsWindowKey(cur(conn))} screen=${JSON.stringify(cur(conn).slice(0, 320))}`);
      break;
    }
    windows += 1;
    if (!(await waitForScreenText(conn, /^\s*>\s*\d{1,6}\s+/m, 5000))) {
      progress.stopReason = 'pageup-no-selected-row';
      console.log(`[sync-all] stopped: PageUp screen has no selected row; screen=${JSON.stringify(cur(conn).slice(0, 320))}`);
      break;
    }
  }
  if (windows > BBS_SYNC_MAX_WINDOWS) progress.stopReason = 'window-limit-reached';
  return progress;
}

async function bbsCrawl({ maxPosts = BBS_SCRAPE_ROWS, allVisible = false, board = BBS_TARGET_BOARD } = {}) {
  if (!BBS_USER || !BBS_PASS) {
    throw new Error('BBS_USER / BBS_PASS not set (add them to .env)');
  }

  const conn = await ensureBbs();
  await enterNewestBoardPosition(conn, board);
  const progress = await syncBbsRowsBackward(conn, {
    stopAtCachedWindow: allVisible,
    maxNewPosts: allVisible ? Infinity : maxPosts,
    progress: { windows: 0, discovered: 0, saved: 0, skipped: 0, stopReason: null },
  });

  const total = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
  const hasNonMarked = progress.saved > 0;
  setMeta.run('last_crawl', new Date().toISOString());
  return {
    saved: progress.saved,
    skipped: progress.skipped,
    windows: progress.windows,
    checked: progress.discovered,
    stopReason: progress.stopReason,
    total,
    hasNonMarked,
    board,
  };
}

// POST /api/crawler/crawl - run the BBS crawler now.
app.post('/api/crawler/crawl', async (req, res) => {
  if (crawlerState.status === 'running') {
    return res.status(409).json({ error: 'a crawl is already running' });
  }
  crawlerState.status = 'running';
  try {
    const result = await bbsCrawl({
      maxPosts: Number(req.body?.maxPosts) || BBS_SCRAPE_ROWS,
      allVisible: req.body?.allVisible === true,
    });
    crawlerState.status = 'idle';
    crawlerState.lastCrawl = new Date().toISOString();
    res.json(result);
  } catch (err) {
    crawlerState.status = 'idle';
    console.error('[bbs-crawl] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crawler/sync-all - explicitly walk every visible board-list page.
app.post('/api/crawler/sync-all', async (req, res) => {
  if (crawlerState.status === 'running' || manualSyncState.status === 'running') {
    return res.status(409).json({ error: 'a crawl is already running' });
  }
  manualSyncState.status = 'running';
  manualSyncState.windows = 0;
  manualSyncState.discovered = 0;
  manualSyncState.saved = 0;
  manualSyncState.skipped = 0;
  manualSyncState.stopReason = null;
  manualSyncState.error = null;
  crawlerState.status = 'running';
  res.status(202).json({ status: 'started' });

  try {
    const conn = await ensureBbs();
    await enterNewestBoardPosition(conn, BBS_TARGET_BOARD);
    await syncBbsRowsBackward(conn);
    manualSyncState.status = 'idle';
    crawlerState.status = 'idle';
    setMeta.run('last_crawl', new Date().toISOString());
    console.log(`[sync-all] complete: windows=${manualSyncState.windows} discovered=${manualSyncState.discovered} saved=${manualSyncState.saved} skipped=${manualSyncState.skipped} stopReason=${manualSyncState.stopReason}`);
  } catch (err) {
    manualSyncState.status = 'error';
    crawlerState.status = 'idle';
    manualSyncState.error = err.message;
    console.error('[sync-all] failed:', err.message);
  }
});

app.get('/api/crawler/sync-all/status', (_req, res) => {
  res.json({ ...manualSyncState });
});

// --- Scheduled BBS crawl job ---
// Runs the BBS crawler on a timer with an overlap guard; tune via env vars.
// The logged-in connection is reused across runs, so the account is not re-logged-in
// (and a browser session not re-kicked) on every tick.
const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS || 60 * 1000);

async function scheduledScrape() {
  if (crawlerState.status === 'running') {
    console.log('[cron] previous crawl still running, skipping this tick');
    return;
  }
  if (!BBS_USER || !BBS_PASS) {
    console.warn('[cron] BBS_USER/BBS_PASS not set; skipping scheduled crawl');
    return;
  }
  crawlerState.status = 'running';
  try {
    const conn = await ensureBbs();
    await enterNewestBoardPosition(conn, BBS_TARGET_BOARD);
    const progress = await syncBbsRowsBackward(conn, {
      stopAtCachedWindow: true,
      progress: { windows: 0, discovered: 0, saved: 0, skipped: 0, stopReason: null },
    });
    crawlerState.lastCrawl = new Date().toISOString();
    console.log(
      `[cron] crawl ok: board=${BBS_TARGET_BOARD} windows=${progress.windows} checked=${progress.discovered} saved=${progress.saved} skipped=${progress.skipped} stopReason=${progress.stopReason}`
    );
  } catch (err) {
    console.error('[cron] crawl failed:', err.message);
  } finally {
    crawlerState.status = 'idle';
  }
}

if (process.env.SCRAPE_ON_BOOT !== '0') {
  setTimeout(scheduledScrape, 2000); // don't block startup
}
setInterval(scheduledScrape, SCRAPE_INTERVAL_MS);
console.log(`[cron] scheduled BBS crawl every ${SCRAPE_INTERVAL_MS} ms`);

// --- Static web client (production / Docker single-port mode) ---
// In local dev the Vite dev server serves the app on :5173 and this directory
// does not exist, so the proxy stays WebSocket/API-only.
const webDist = join(__dirname, 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback: any non-API GET for a path that is not a real file returns index.html.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
  console.log(`[proxy] Serving built web client from ${webDist}`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy+api] Listening on ws://0.0.0.0:${PORT} and http://0.0.0.0:${PORT}`);
});

wss.on('error', (err) => {
  console.error(`[proxy] Server error: ${err.message}`);
});
