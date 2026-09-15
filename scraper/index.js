/**
 * Bahamut BBS WebSocket Scraper
 *
 * Connects directly to the BBS terminal WebSocket API (wss://term.gamer.com.tw/bbs)
 * using the xterm.js terminal emulator to parse the ANSI/Big5 screen output.
 *
 * Pagination strategy (verified working):
 *   Home  = oldest posts (post #1, ~2010)
 *   PageDown = advance toward newer posts
 *   End   = newest posts (most recent)
 *   PageUp = go backward toward older posts
 *
 * Auto-restarts on crash. Persists bad-post skip-list in DB.
 *
 * Usage: node scraper/index.js
 */

const WebSocket = require('ws');
const iconv = require('iconv-lite');
const { Terminal } = require('@xterm/headless');
const Database = require('better-sqlite3');

const WS_URL = 'wss://term.gamer.com.tw/bbs';
const ORIGIN = 'https://term.gamer.com.tw';
const DB_PATH = '/home/galaxy14/project/webbbs/data/webbbs.db';
const BOARD = 'chat';
const BBS_USER = process.env.BBS_USER || '';
const BBS_PASS = process.env.BBS_PASS || '';

let runCount = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseBBSDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr.startsWith('m')) {
    const yyyymm = dateStr.substring(1, 6);
    const dd = dateStr.substring(7, 9);
    const yy = parseInt(yyyymm.substring(0, 2), 10);
    const mm = parseInt(yyyymm.substring(2, 4), 10);
    const year = 1911 + yy;
    return year + '-' + String(mm).padStart(2, '0') + '-' + dd;
  }
  const parts = dateStr.split('/');
  return '2026-' + parts[0] + '-' + parts[1];
}

function extractPosts(screen) {
  const posts = [];
  const lines = screen.split('\n');
  // Pattern: postno, optional mark, date (MM/DD or mYYMM/DD), author, title
  //   "    1 m9901/21 sega     ◇ title"
  //   " 61861       07/13 author     Re title"
  const re = /^\s*(\d+)\s+(?:([+M=s])\s+)?((?:\d{2}\/\d{2})|m\d{4}\/\d{2})\s+(\S+)\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      posts.push({
        postno: m[1],
        date: m[3],
        author: m[4],
        title: m[5].trim()
      });
    }
  }
  return posts;
}

// ─── Main loop ───────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);

  const insertPost = db.prepare(
    'INSERT OR REPLACE INTO posts (postno, board, title, author, date, content) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updatePost = db.prepare('UPDATE posts SET content = ? WHERE postno = ?');
  const markBad = db.prepare('INSERT OR IGNORE INTO bad_posts (postno) VALUES (?)');
  const getBad = db.prepare('SELECT postno FROM bad_posts').all().map(r => r.postno);
  const badPosts = new Set(getBad);

  runCount++;
  console.log('[scraper] Run #' + runCount + ', bad-post skip-list size: ' + badPosts.size);

  // Terminal setup
  const term = new Terminal({ rows: 24, cols: 80, allowProposedApi: true });
  term.resize(80, 24);

  const ws = new WebSocket(WS_URL, { origin: ORIGIN, protocol: 'telnet', perMessageDeflate: true });

  let state = 'CONNECTING';
  let enterCount = 0;
  let navigationRetryCount = 0;
  let lastScreen = '';
  let scrapeMode = false;
  let dismissCount = 0;
  let usernameTimer = null;
  let usernameSent = false;
  let usernameSentAt = 0;
  let loginWaitPassCount = 0;

  const send = (str) => {
    ws.send(iconv.encode(str, 'big5'));
  };

  const getScreen = () => {
    let lines = [];
    for (let i = 0; i < term.rows; i++) {
      const line = term.buffer.active.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n');
  };

  // ── Post-reading state (persists across auto-restarts via DB) ────────────
  const visitedPosts = new Set();
  let consecutiveNoNewPosts = 0;
  const MAX_CONSECUTIVE_NO_NEW = 3;
  let stuckCount = 0;
  let lastPostnoOnScreen = null;
  let scrapePageRunning = false;

  // ── State machine ─────────────────────────────────────────────────────────

  function handleState(screen) {
    // Guard: once in scrape mode, only handle duplicate-login (no other WS messages)
    if (scrapeMode) {
      if (screen.includes('刪除其他重複登入') || screen.match(/刪除.*重複登入/)) {
        send('y\r');
      }
      return;
    }

    lastScreen = screen;
    const now = Date.now();

    // Handle duplicate-login prompt at ANY state
    if (screen.includes('rmOtherLogin') || screen.includes('rmOther')) {
      // The actual text is Chinese: "刪除其他重複登入"
      const chineseMatch = screen.match(/刪除.*重複登入/) || screen.match(/刪除其他重複登入/);
      if (chineseMatch) {
        console.log('[scraper] Duplicate login - deleting...');
        send('y\r');
        return;
      }
    }

    const anyKey = screen.includes('pleasePressAnyKey') ||
      screen.includes('請按任意鍵') ||
      screen.includes('任意鍵') ||
      screen.includes('Any key') ||
      screen.includes('請按 Enter');

    switch (state) {

      case 'CONNECTING':
        if (screen.includes('pleaseEnterID') ||
            screen.includes('勇者代號') ||
            screen.includes('輸入代號') ||
            screen.includes('請輸入')) {
          state = 'LOGIN_ID';
          console.log('[scraper] CONNECTING -> LOGIN_ID');
          handleState(screen);
        } else if (!screen.includes('勇者代號') && !screen.includes('輸入代號') &&
                   (screen.includes('Champion') || screen.includes('對戰'))) {
          send('\r');
        }
        break;

      case 'LOGIN_ID':
        if (!usernameSent) {
          if (!usernameTimer) {
            console.log('[scraper] Scheduling username, setTimeoutId=' + usernameTimer);
            usernameTimer = setTimeout(() => {
              console.log('[scraper] TIMER FIRED! sending username');
              send(BBS_USER + '\r');
              usernameTimer = null;
              usernameSent = true;
              state = 'LOGIN_WAIT_PASS';
              usernameSentAt = Date.now();
            }, 10000);
            console.log('[scraper] After scheduling, timerId=' + usernameTimer + ' usernameSent=' + usernameSent);
          }
        }
        if (!screen.includes('勇者代號') && !screen.includes('請輸入密碼') && anyKey && enterCount < 3) {
          send('\r');
          enterCount++;
        }
        break;

      case 'LOGIN_WAIT_PASS':
        loginWaitPassCount++;
        if (loginWaitPassCount % 10 === 1) {
          console.log('[scraper] LOGIN_WAIT_PASS #' + loginWaitPassCount + ' since=' + (Date.now() - usernameSentAt) + 'ms screen=' + screen.substring(0, 50).replace(/\n/g, '|'));
        }
        if (screen.includes('請輸入密碼') || screen.includes('密碼：') || screen.includes('請輸入勇者密碼')) {
          console.log('[scraper] Sending password');
          send(BBS_PASS + '\r');
          state = 'DISMISS_WELCOME';
          enterCount = 0;
        } else if (Date.now() - usernameSentAt > 20000) {
          console.log('[scraper] Password prompt timeout - retrying');
          usernameSent = false;
          usernameSentAt = 0;
          state = 'LOGIN_ID';
        }
        break;

      case 'LOGIN_PASS':
        if (screen.includes('pleaseEnterPwd') ||
            screen.includes('請輸入密碼') ||
            screen.includes('密碼：')) {
          if (!passwordTimer) {
            console.log('[scraper] Sending password');
            send(BBS_PASS + '\r');
            state = 'DISMISS_WELCOME';
            enterCount = 0;
            passwordTimer = null;
          }
        } else if (screen.includes('請按任意鍵') || screen.includes('任意鍵')) {
          send('\r');
          enterCount = 0;
        }
        break;

      case 'DISMISS_WELCOME': {
        const atMenu = screen.includes('Main Menu') ||
          screen.includes('MainMenu') ||
          screen.includes('主功能表') ||
          screen.includes('Main Function') ||
          screen.includes('A)nnounce');
        if (atMenu) {
          console.log('[scraper] At main menu');
          state = 'GO_TO_BOARD';
          handleState(screen);
        } else if ((screen.includes('請按任意鍵') || screen.includes('繼續')) && !screen.includes('勇者代號')) {
          console.log('[scraper] Dismissing welcome...');
          send('\r');
          enterCount = 0;
        } else {
          console.log('[scraper] DISMISS_WELCOME no match: ' + screen.substring(0, 100).replace(/\n/g, '|'));
        }
        break;
      }

      case 'GO_TO_BOARD': {
        const atMenu = screen.includes('Main Menu') ||
          screen.includes('主功能表') ||
          screen.includes('Main Function') ||
          screen.includes('A)nnounce');
        if (atMenu) {
          console.log('[scraper] Going to board list (b)...');
          send('b\r');
          state = 'BOARD_LIST';
          return;
        } else if (anyKey && enterCount < 3) {
          send('\r');
          enterCount++;
        }
        break;
      }

      case 'BOARD_LIST': {
        const onBoardList = screen.includes('請輸入看板名稱') ||
          screen.includes('輸入看板名稱') ||
          screen.includes('(B)oards') ||
          screen.includes('(R)ead');
        if (onBoardList) {
          console.log('[scraper] At board list - using search to find Chat...');
          send('sChat\r');
          state = 'IN_BOARD_SPLASH';
          enterCount = 0;
          return;
        } else if (screen.includes('主功能表') && !screen.includes('請輸入看板名稱')) {
          setTimeout(() => handleState(getScreen()), 500);
          return;
        } else if (anyKey && enterCount < 5) {
          send('\r');
          enterCount++;
        }
        break;
      }

      case 'IN_BOARD_SPLASH': {
        // In 精華區 (featured compilation) - dismiss with Left Arrow, track dismissal to prevent infinite loop
        if ((screen.includes('【精華文章】') || screen.includes('精華文章') || screen.includes('看板《尚未選定》')) && dismissCount < 3) {
          console.log('[scraper] In 精華區 - pressing Left Arrow (attempt ' + (dismissCount + 1) + ')...');
          send('\x1b[D');
          dismissCount++;
          setTimeout(() => handleState(getScreen()), 1500);
          return;
        }
        if (dismissCount >= 3) console.log('[scraper] 精華區 dismiss count exceeded, forcing board detection');
        const boardLoaded = screen.includes('文章列表') ||
          screen.includes('看板《') ||
          screen.includes('Chat');
        if (boardLoaded && !screen.includes('進板畫面') && !anyKey) {
          console.log('[scraper] Board loaded');
          state = 'SCRAPE';
          navigationRetryCount = 0;
          send('\x1b[1~'); // Home - go to oldest posts
          setTimeout(() => {
            handleState(getScreen());
          }, 2000);
        } else if (screen.includes('進錯板') || screen.includes('不存在') || screen.includes('查無此板')) {
          console.log('[scraper] Board not found, retrying...');
          send('b\r');
          state = 'BOARD_LIST';
          navigationRetryCount++;
          if (navigationRetryCount > 5) {
            console.error('[scraper] Navigation failed 5 times');
            ws.close();
          }
        } else {
          send('\r');
          setTimeout(() => handleState(getScreen()), 100);
        }
        break;
      }

      case 'SCRAPE':
        if (anyKey) {
          send('\r');
          return;
        }
        // Exit the message-driven loop - hand off to async scrapePage
        // Use setTimeout to avoid re-entering handleState from the WS message cycle
        scrapeMode = true;
        setTimeout(() => scrapePage(getScreen()));
        break;
    }
  }

  // ── Post-list scraping loop ───────────────────────────────────────────────

  async function scrapePage(screen) {
    if (scrapePageRunning) return;
    scrapePageRunning = true;

    const posts = extractPosts(screen);
    console.log('[scraper] Posts on screen: ' + posts.length);

    if (posts.length === 0) {
      scrapePageRunning = false;
      console.log('[scraper] EMPTY SCREEN:\n' + screen);
      console.log('[scraper] ---END EMPTY---');
      send('\x1b[6~');
      await sleep(3000);
      scrapePage(getScreen());
      return;
    }

    let newOnPage = 0;
    for (const p of posts) {
      if (!visitedPosts.has('bbs_' + BOARD + '_' + p.postno)) newOnPage++;
    }
    console.log('[scraper] New posts this page: ' + newOnPage);

    if (newOnPage === 0) {
      consecutiveNoNewPosts++;
      if (consecutiveNoNewPosts >= MAX_CONSECUTIVE_NO_NEW) {
        console.log('[scraper] End of list');
        scrapePageRunning = false;
        ws.close();
        return;
      }
    } else {
      consecutiveNoNewPosts = 0;
    }

    // Read each post on the page
    for (const post of posts) {
      const bbsPostno = 'bbs_' + BOARD + '_' + post.postno;

      // Skip already visited and known bad posts
      if (visitedPosts.has(bbsPostno) || badPosts.has(bbsPostno)) {
        send('\x1b[B'); // ArrowDown
        await sleep(150);
        continue;
      }

      // Detect stuck on same postno
      if (post.postno === lastPostnoOnScreen) {
        stuckCount++;
        if (stuckCount > 3) {
          console.log('[scraper] Stuck on post ' + post.postno + ' - PageDown to advance');
          send('\x1b[6~'); // PageDown
          await sleep(2000);
          stuckCount = 0;
          scrapePageRunning = false;
          return;
        }
      } else {
        stuckCount = 0;
      }
      lastPostnoOnScreen = post.postno;

      visitedPosts.add(bbsPostno);

      // Insert post metadata into DB
      try {
        insertPost.run(bbsPostno, BOARD, post.title, post.author, parseBBSDate(post.date), '');
      } catch (e) { /* duplicate */ }

      // Enter the post via ArrowRight x 2
      send('\x1b[C');
      await sleep(1200);
      send('\x1b[C');
      await sleep(1500);

      const currentScreen = getScreen();

      // Check if we actually entered the post by looking for post content markers
      const inPost = currentScreen.includes('標題:') || currentScreen.includes('時間:') || currentScreen.includes('作者:');
      if (!inPost) {
        // Still on post list - ArrowRight did not work (deleted post)
        console.log('[scraper] ! ' + post.postno + ' (ArrowRight failed - marking bad)');
        try { markBad.run(bbsPostno); badPosts.add(bbsPostno); } catch {}
        send('q');
        await sleep(500);
        continue;
      }

      // Extract post content
      let contentText = '';
      try {
        contentText = extractContent(currentScreen);
      } catch (e) { /* skip */ }

      if (contentText.length > 10) {
        try {
          updatePost.run(contentText, bbsPostno);
          console.log('[scraper] OK ' + post.postno + ': ' + post.title.substring(0, 30));
        } catch (e) {
          console.log('[scraper] FAIL ' + post.postno + ': ' + e.message);
        }
      } else {
        console.log('[scraper] -- ' + post.postno + ' (no content)');
      }

      // Go back to post list - try multiple exit keys
      send('q\r');
      await sleep(3000);

      let s = getScreen();
      if (s.includes('標題:') || s.includes('時間:')) {
        // q didn't work, try e
        send('e\r');
        await sleep(3000);
        s = getScreen();
      }
      if (s.includes('標題:') || s.includes('時間:')) {
        // e didn't work, try Left Arrow
        send('\x1b[D');
        await sleep(3000);
        s = getScreen();
      }
      if (s.includes('標題:') || s.includes('時間:')) {
        // Still in post, try Ctrl+C
        send('\x03');
        await sleep(3000);
      }
    }

    // ── Navigate to next page ───────────────────────────────────────────────
    scrapePageRunning = false;
    send('\x1b[6~'); // PageDown
    await sleep(3000);

    const nextScreen = getScreen();
    const nextPosts = extractPosts(nextScreen);
    let nextNew = 0;
    for (const p of nextPosts) {
      if (!visitedPosts.has('bbs_' + BOARD + '_' + p.postno)) nextNew++;
    }

    if (nextPosts.length === 0) {
      console.log('[scraper] Empty next page - retry PageDown');
      send('\x1b[6~');
      await sleep(3000);
      scrapePage(getScreen());
    } else if (nextNew === 0) {
      consecutiveNoNewPosts++;
      if (consecutiveNoNewPosts >= MAX_CONSECUTIVE_NO_NEW) {
        console.log('[scraper] End of list');
        ws.close();
        return;
      }
      scrapePage(nextScreen);
    } else {
      consecutiveNoNewPosts = 0;
      scrapePage(nextScreen);
    }
  }

  // ── Content extraction ────────────────────────────────────────────────────

  function extractContent(screen) {
    const lines = screen.split('\n');
    const contentLines = [];
    let foundTime = false;
    let foundDashDash = false;

    for (const line of lines) {
      if (line.includes('時間:')) {
        foundTime = true;
        continue;
      }
      if (foundTime && line.trim() === '--') {
        foundDashDash = true;
        continue;
      }
      if (foundTime && (line.includes('文章選讀') || line.includes('※ 發文'))) {
        break;
      }
      if (foundTime && !foundDashDash && line.trim()) {
        contentLines.push(line.trim());
      }
    }

    return contentLines.join('\n');
  }

  // ── WebSocket event handlers ─────────────────────────────────────────────

  ws.on('open', () => {
    console.log('[scraper] Connected to Bahamut BBS');
    state = 'CONNECTING';
  });

  let _lastScreen = '';
  let msgCount = 0;

  ws.on('message', (data) => {
    msgCount++;
    try {
      const text = iconv.decode(Buffer.isBuffer(data) ? data : Buffer.from(data), 'big5');
      term.write(text);
      const s = getScreen();
      handleState(s);
    } catch(e) {
      console.error('[scraper] MSG error: ' + e.message);
    }
  });

  ws.on('close', () => {
    console.log('[scraper] Connection closed - restarting in 2s');
    setTimeout(() => main(), 2000);
  });

  ws.on('error', (err) => {
    console.error('[scraper] WS Error: ' + err.message);
    ws.close();
  });

  ws.on('error', (err) => {
    console.error('[scraper] WS Error: ' + err.message);
    ws.close();
  });
}

main().catch(err => {
  console.error('[scraper] Fatal: ' + err.message);
  setTimeout(() => main(), 5000);
});
