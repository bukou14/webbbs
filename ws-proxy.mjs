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
import { mkdirSync, writeFileSync } from 'fs';
import iconv from 'iconv-lite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.argv[2] || '8080', 10);
const BBS_URL = 'wss://term.gamer.com.tw/bbs';
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
`);

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

// --- BBS Crawler Logic ---

function decodeCrawlerBytes(bytes) {
  if (!bytes || bytes.length === 0) return '';
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    return iconv.decode(buf, 'big5').replace(/\uFFFD+/g, ' ').trim();
  } catch {}
  return buf.toString('ascii').replace(/[^\x20-\x7E]/g, '');
}

function parsePostListRaw(text) {
  const items = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Strip ANSI
    const cleanLine = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const match = cleanLine.match(/^\s*(\d+)\s+([~+M=sS!◇◆])\s*(.*)$/);
    if (!match) continue;

    const postNum = match[1];
    let remainder = match[3];

    // Remove date at end (e.g. "  7/13" or " 7/13/12")
    const dateMatch = remainder.match(/\d{1,2}\/\d{1,2}(?:\/\d{1,2})?\s*$/);
    let titleAndAuthor = remainder;
    if (dateMatch) {
      titleAndAuthor = remainder.substring(0, remainder.lastIndexOf(dateMatch[0])).trim();
    }

    // Split by 2+ spaces
    const parts = titleAndAuthor.split(/\s{2,}/);
    let title = parts[0].trim();

    if (!title) title = titleAndAuthor.trim();

    if (title.length > 0) {
      items.push({
        postNum,
        title: title.substring(0, 60),
      });
    }
  }

  return items;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function crawlBoard() {
  crawlerState.status = 'running';
  console.log('[crawler] Starting crawl...');

  const BBS_WS_URL = `ws://localhost:${PORT}`;
  let ws;
  let sharedBuffer = '';
  let waiterResolve = null;
  let waiterTimeout = null;

  const insertPost = db.prepare(`
    INSERT OR IGNORE INTO posts (postno, board, title, author, date, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const waitForBuffer = (ms = 5000) => {
    return new Promise((resolve) => {
      sharedBuffer = '';
      waiterResolve = null;
      const cap = resolve;
      waiterTimeout = setTimeout(() => { cap(sharedBuffer); }, ms);
      waiterResolve = (val) => {
        if (waiterTimeout) clearTimeout(waiterTimeout);
        cap(val);
      };
    });
  };

  const waitForPattern = (pattern, timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (sharedBuffer.includes(pattern)) {
          clearInterval(interval);
          if (waiterTimeout) clearTimeout(waiterTimeout);
          resolve(sharedBuffer);
        }
      }, 200);
      const to = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(`Pattern not found: ${pattern}`));
      }, timeoutMs);
      if (waiterTimeout) clearTimeout(waiterTimeout);
      waiterTimeout = to;
    });
  };

  try {
    ws = new WebSocket(BBS_WS_URL);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    console.log('[crawler] Connected to proxy');

    // Shared message handler — single buffer, single listener
    ws.on('message', (msg) => {
      const raw = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      const decoded = decodeCrawlerBytes(raw);
      sharedBuffer += decoded;
      if (waiterResolve) { const r = waiterResolve; waiterResolve = null; r(sharedBuffer); }
    });

    ws.on('close', () => {
      if (waiterResolve) { waiterResolve(sharedBuffer); }
    });

    // Fresh connections land in K.O. game — dismiss it first, then wait for login prompt
    console.log('[crawler] Waiting for K.O. game to appear...');
    let koDismissed = false;
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      if (sharedBuffer.includes('Champion') || sharedBuffer.includes('[ＫＯ]') || sharedBuffer.includes('K.O.') || sharedBuffer.includes('KO')) {
        console.log('[crawler] K.O. game detected, dismissing with Enter...');
        ws.send('\r');
        koDismissed = true;
        await sleep(1000);
        break;
      }
    }
    if (!koDismissed) {
      console.log('[crawler] No K.O. game detected, proceeding...');
    }

    // Login sequence - wait for username prompt to appear naturally
    console.log('[crawler] Login: waiting for username prompt...');
    try {
      await waitForPattern('請輸入勇者代號：', 15000);
    } catch {
      console.log('[crawler] DEBUG initial buffer:', sharedBuffer.substring(0, 500));
      throw new Error('Username prompt not found');
    }
    ws.send(BBS_USER + '\r');

    console.log('[crawler] Login: waiting for password prompt (or K.O. game)...');
    let passwordFound = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (sharedBuffer.includes('請輸入勇者密碼：')) {
        passwordFound = true;
        console.log('[crawler] Password prompt appeared after ' + (i+1) + 's');
        break;
      }
      if (sharedBuffer.includes('Champion') || sharedBuffer.includes('[ＫＯ]') || sharedBuffer.includes('K.O.') || sharedBuffer.includes('KO')) {
        console.log('[crawler] K.O. game appeared, sending Enter...');
        ws.send('\r');
      }
    }
    if (!passwordFound) {
      console.log('[crawler] DEBUG after username (len=' + sharedBuffer.length + '):', sharedBuffer.substring(0, 500));
      throw new Error('Password prompt not found');
    }
    ws.send(BBS_PASS + '\r');

    console.log('[crawler] Login: waiting for menu...');
    try {
      await waitForPattern('您想刪除其他重複的 login', 8000);
      ws.send('Y\r');
    } catch {}
    try {
      await waitForPattern('精華公佈欄', 15000);
    } catch {
      console.log('[crawler] DEBUG after password (len=' + sharedBuffer.length + '):', sharedBuffer.substring(0, 500));
      throw new Error('Menu not found');
    }

    // Navigation: R -> Enter -> B -> Enter -> s (search Chat)
    console.log('[crawler] Step 1: R (看板列表)...');
    ws.send('R\r');
    await waitForPattern('看板列表', 15000);

    console.log('[crawler] Step 2: Enter...');
    ws.send('\r');
    await waitForPattern('佈告討論區', 15000);

    console.log('[crawler] Step 3: B (佈告討論區)...');
    ws.send('B\r');
    await waitForPattern('chat', 15000);

    console.log('[crawler] Step 4: s (search Chat)...');
    ws.send('s\r');
    await waitForPattern('Chat', 15000);

    console.log('[crawler] Reading posts...');
    // Terminal buffer now has post list — parse it
    const postItems = parsePostListRaw(sharedBuffer);
    console.log(`[crawler] Found ${postItems.length} posts on page 1`);
    if (postItems.length > 0) {
      console.log('[crawler] Sample post:', JSON.stringify(postItems[0]));
    } else {
      console.log('[crawler] DEBUG (first 400):', sharedBuffer.substring(0, 400));
    }

    for (const post of postItems) {
      try {
        insertPost.run(post.postNum, 'chat', post.title, '', '', '');
      } catch {}
    }

    let pageCount = 1;

    while (pageCount < 50) {
      console.log(`[crawler] Paginating: PgDown (page ${pageCount + 1})...`);
      ws.send('\x1b[6~');
      try {
        const pageBuf = await waitForBuffer(8000);
        const newItems = parsePostListRaw(pageBuf);
        if (newItems.length === 0) {
          console.log('[crawler] No more posts, stopping.');
          break;
        }
        for (const post of newItems) {
          try { insertPost.run(post.postNum, 'chat', post.title, '', '', ''); } catch {}
        }
        console.log(`[crawler] Page ${pageCount + 1}: ${newItems.length} posts`);
        sharedBuffer = '';
        pageCount++;
        await sleep(500);
      } catch (err) {
        console.log(`[crawler] Pagination error: ${err.message}, stopping.`);
        break;
      }
    }

    const finalCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
    console.log(`[crawler] Done. Total posts saved: ${finalCount}`);
    crawlerState.status = 'idle';
    crawlerState.lastCrawl = new Date().toISOString();

    if (ws && ws.readyState === WebSocket.OPEN) { ws.close(); }
  } catch (err) {
    console.error('[crawler] Error:', err.message);
    crawlerState.status = 'idle';
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.close(); } catch {} }
  }
}

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
      SELECT id, postno, title, author, date, content, created_at
      FROM posts
      WHERE board = ?
      ORDER BY id DESC
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

// GET /api/crawler/status
app.get('/api/crawler/status', (req, res) => {
  try {
    const postCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
    crawlerState.postCount = postCount;
    res.json({
      status: crawlerState.status,
      lastCrawl: crawlerState.lastCrawl,
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

// POST /api/crawler/crawl - PERMANENTLY BLOCKED
// Fresh BBS WebSocket connections land in K.O. game and cannot login.
// Use GET /api/crawler/scrape instead (HTTP scraper for forum.gamer.com.tw)
app.post('/api/crawler/crawl', (req, res) => {
  res.status(410).json({ error: 'BBS WebSocket crawl is permanently blocked. Fresh connections land in K.O. game. Use GET /api/crawler/scrape instead.' });
});

// GET /api/crawler/scrape - HTTP scraper for forum.gamer.com.tw (bypasses WS login issues)
app.get('/api/crawler/scrape', async (req, res) => {
  crawlerState.status = 'running';
  try {
    const { fetch } = globalThis;
    const updatePost = db.prepare(`UPDATE posts SET content = ? WHERE postno = ?`);
    const insertPost = db.prepare(`INSERT OR REPLACE INTO posts (postno, board, title, author, date, content) VALUES (?, ?, ?, ?, ?, ?)`);

    const allPosts = [];
    const BOARD_URL = 'https://forum.gamer.com.tw/B.php?bsn=23839&subbsn=0';

    for (let page = 1; page <= 5; page++) {
      const url = page === 1 ? BOARD_URL : `${BOARD_URL}&page=${page}`;
      console.log(`[scraper] Fetching page ${page}: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        }
      });

      if (!response.ok) {
        console.log(`[scraper] Page ${page} failed: ${response.status}`);
        break;
      }

      const html = await response.text();

      // Process each <tr> row that contains a post link — each row is self-contained
      // Pattern: <tr ...> ... <a href="C.php?bsn=23839&snA=N&tnum=M"> ... <p class="b-list__main__title">TITLE</p> ... <a class="b-list__main__author">AUTHOR</a> ... YYYY-MM-DD ...
      const rowMatches = [...html.matchAll(/<tr[^>]+class="b-list__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)];

      let pagePosts = 0;
      for (const row of rowMatches) {
        const rowHtml = row[1];

        // Extract post URL (the main title link — not the "latest reply" link)
        const titleLinkMatch = rowHtml.match(/href="(C\.php\?bsn=23839&snA=\d+&tnum=\d+)"[^>]*>\s*<div[^>]*>/);
        const postUrl = titleLinkMatch ? 'https://forum.gamer.com.tw/' + titleLinkMatch[1] : '';

        // Extract snA and tnum for postno
        const snAMatch = postUrl.match(/snA=(\d+)/);
        const tnumMatch = postUrl.match(/tnum=(\d+)/);
        if (!snAMatch) continue;

        // Extract title: <p class="b-list__main__title">TITLE</p> inside the title link div
        const titleMatch = rowHtml.match(/<p[^>]+class="b-list__main__title"[^>]*>([^<]+)<\/p>/);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // Extract author: <a class="b-list__main__author">NAME</a>
        const authorMatch = rowHtml.match(/<a[^>]+class="b-list__main__author"[^>]*>([^<]+)<\/a>/);
        const author = authorMatch ? authorMatch[1].trim() : '';

        // Extract date: YYYY-MM-DD in the time cell
        const dateMatch = rowHtml.match(/<td[^>]+class="b-list__time"[^>]*>[\s\S]*?(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '';

        if (!title || title.includes('系統')) continue;

        const postno = `chat_${snAMatch[1]}_${tnumMatch ? tnumMatch[1] : '1'}`;

        try {
          insertPost.run(postno, 'chat', title, author, date, '');
          allPosts.push({ postno, title, author, date, postUrl });
          pagePosts++;
        } catch {}
      }

      console.log(`[scraper] Page ${page}: ${pagePosts} posts`);
      if (pagePosts === 0) break;
    }

    // Fetch full content for each post
    console.log(`[scraper] Fetching content for ${allPosts.length} posts...`);
    let contentCount = 0;
    for (const post of allPosts) {
      if (!post.postUrl) continue;
      try {
        const resp = await fetch(post.postUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          }
        });
        if (!resp.ok) continue;
        const postHtml = await resp.text();

        const contentMatch = postHtml.match(/<div[^>]+class="c-article__content"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/);
        if (contentMatch) {
          const rawContent = (contentMatch[1] || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, '\n\n').trim();
          try {
            updatePost.run(rawContent, post.postno);
            contentCount++;
          } catch (e) {
            console.log(`[scraper] UPDATE error for ${post.postno}: ${e.message}`);
          }
        } else {
          console.log(`[scraper] No content for ${post.postno}`);
        }
      } catch (e) {
        console.log(`[scraper] Post fetch error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    const total = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ?').get('chat').count;
    const withContent = db.prepare('SELECT COUNT(*) as count FROM posts WHERE board = ? AND length(content) > 0').get('chat').count;
    crawlerState.status = 'idle';
    crawlerState.lastCrawl = new Date().toISOString();
    console.log(`[scraper] Done. Total posts: ${total}, with content: ${withContent}`);
    res.json({ saved: allPosts.length, total, withContent, posts: allPosts.slice(0, 10) });
  } catch (err) {
    console.error('[scraper] Error:', err.message);
    crawlerState.status = 'idle';
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy+api] Listening on ws://0.0.0.0:${PORT} and http://0.0.0.0:${PORT}`);
});

wss.on('error', (err) => {
  console.error(`[proxy] Server error: ${err.message}`);
});
