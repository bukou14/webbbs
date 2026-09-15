/**
 * BBS Post Recovery Crawler
 *
 * Recovers content for posts we already have metadata for but no content.
 * Uses the BBS "jump to post number" command to navigate directly:
 *   1. Type the post number
 *   2. Press Enter to jump
 *   3. Extract content and update DB
 *
 * This avoids sequential navigation (ArrowDown) and crash loops on deleted posts.
 * Auto-restarts on crash.
 */

const WebSocket = require('ws');
const iconv = require('iconv-lite');
const { Terminal } = require('@xterm/headless');
const Database = require('better-sqlite3');

const WS_URL = 'wss://term.gamer.com.tw/bbs';
const ORIGIN = 'https://term.gamer.com.tw';
const DB_PATH = '/home/galaxy14/project/webbbs/data/webbbs.db';
const BOARD = 'chat';

let runCount = 0;

  function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sendWithDelay(send, keys, count, delay) {
  for (let i = 0; i < count; i++) {
    send(keys);
    if (delay > 0) sleep(delay);
  }
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
    if (foundTime && (line.includes('文章選讀') || line.includes('※ 發文') || line.includes('瀏覽 P.'))) {
      break;
    }
    if (foundTime && !foundDashDash && line.trim()) {
      contentLines.push(line.trim());
    }
  }

  return contentLines.join('\n');
}

function extractPostsOnScreen(screen) {
  const posts = [];
  const lines = screen.split('\n');
  const re = /^\s*(\d+)\s+(?:([+M=s])\s+)?((?:\d{2}\/\d{2})|m\d{4}\/\d{2})\s+(\S+)\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      posts.push({ postno: m[1], date: m[3], author: m[4], title: m[5].trim() });
    }
  }
  return posts;
}

async function main() {
  const db = new Database(DB_PATH);
  const updatePost = db.prepare('UPDATE posts SET content = ? WHERE postno = ?');
  const markBad = db.prepare('INSERT OR IGNORE INTO bad_posts (postno) VALUES (?)');

  // Get all posts without content, ordered by post number
  const noContentPosts = db.prepare(
    "SELECT postno, date, author, title FROM posts WHERE postno LIKE 'bbs_%' AND (content IS NULL OR length(content) = 0) ORDER BY CAST(REPLACE(postno, 'bbs_chat_', '') AS INTEGER)"
  ).all();

  runCount++;
  console.log('[recovery] Run #' + runCount + ', posts to recover: ' + noContentPosts.length);

  const term = new Terminal({ rows: 24, cols: 80, allowProposedApi: true });
  const ws = new WebSocket(WS_URL, { origin: ORIGIN, protocol: 'telnet' });

  let state = 'CONNECTING';
  let enterCount = 0;
  let scrapeMode = false;

  const send = (str) => { ws.send(iconv.encode(str, 'big5')); };

  const getScreen = () => {
    let lines = [];
    for (let i = 0; i < term.rows; i++) {
      const line = term.buffer.active.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n');
  };

  function handleState(screen) {
    if (scrapeMode) return;

    const anyKey = screen.includes('請按任意鍵') || screen.includes('任意鍵') || screen.includes('Any key') || screen.includes('請按 Enter');

    switch (state) {
      case 'CONNECTING':
        if (screen.includes('勇者代號') || screen.includes('輸入代號') || screen.includes('請輸入')) {
          state = 'LOGIN_ID';
          handleState(screen);
        } else if (screen.includes('對戰で己を磨け') || screen.includes('Champion') || screen.includes('バハムート') || screen.includes('CHAMPION')) {
          send('\r');
          enterCount++;
        }
        break;

      case 'LOGIN_ID':
        if (screen.includes('勇者代號') || screen.includes('輸入代號')) {
          send((process.env.BBS_USER || '') + '\r');
          state = 'LOGIN_PASS';
        } else if (anyKey && enterCount < 3) {
          send('\r');
          enterCount++;
        }
        break;

      case 'LOGIN_PASS':
        if (screen.includes('請輸入密碼') || screen.includes('密碼：')) {
          send((process.env.BBS_PASS || '') + '\r');
          state = 'DISMISS_WELCOME';
          enterCount = 0;
        } else if (anyKey && enterCount < 3) {
          send('\r');
          enterCount++;
        }
        break;

      case 'DISMISS_WELCOME': {
        const atMenu = screen.includes('主功能表') || screen.includes('Main Menu') || screen.includes('A)nnounce');
        if (atMenu) {
          state = 'GO_TO_BOARD';
          handleState(screen);
        } else if (anyKey && enterCount < 5) {
          send('\r');
          enterCount++;
        }
        break;
      }

      case 'GO_TO_BOARD': {
        const atMenu = screen.includes('主功能表') || screen.includes('A)nnounce');
        if (atMenu) {
          console.log('[recovery] At main menu, going to board list (b)...');
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
          console.log('[recovery] At board list - using search to find Chat...');
          send('sChat\r');
          state = 'BOARD_SPLASH_NAV';
          return;
        } else if (screen.includes('主功能表') && !screen.includes('請輸入看板名稱')) {
          // Still on main menu
          setTimeout(() => handleState(getScreen()), 500);
          return;
        } else if (anyKey && enterCount < 5) {
          send('\r');
          enterCount++;
        }
        break;
      }

      case 'BOARD_SPLASH_NAV': {
        const boardLoaded = screen.includes('文章列表') || screen.includes('看板《') || screen.includes('Chat');
        if (boardLoaded && !screen.includes('進板畫面') && !anyKey) {
          console.log('[recovery] At Chat board, starting recovery...');
          scrapeMode = true;
          setTimeout(() => startRecovery(noContentPosts, updatePost, markBad, send, getScreen, ws, db));
        } else if (screen.includes('進錯板') || screen.includes('不存在')) {
          send('\r');
        } else {
          send('\r');
        }
        break;
      }
    }
  }

  ws.on('open', () => {
    console.log('[recovery] WS open');
    state = 'CONNECTING';
  });

  let _debounceTimer = null;
  let _debounceActive = false;

  ws.on('message', (data) => {
    term.write(iconv.decode(data, 'big5'));

    // Navigation states: process on every message
    if (state === 'BOARD_SEARCH_NAV' || state === 'BOARD_SPLASH_NAV') {
      handleState(getScreen());
      return;
    }

    // Start debounce if not active
    if (!_debounceActive) {
      _debounceActive = true;
      _debounceTimer = setTimeout(() => {
        _debounceActive = false;
        handleState(getScreen());
      }, 800);
    }
    // Else: keep resetting the timer until 800ms passes with no new messages
    else {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _debounceActive = false;
        handleState(getScreen());
      }, 800);
    }
  });

  ws.on('close', (code, reason) => {
    const reasonStr = Buffer.from(reason||'').toString('hex');
    console.log('[recovery] WS closed code=' + code + ' reason=' + reasonStr + ' - waiting 30s before restart...');
    setTimeout(() => main(), 30000);
  });

  ws.on('error', (err) => {
    console.error('[recovery] WS error: ' + err.message);
    ws.close();
  });
}

async function startRecovery(noContentPosts, updatePost, markBad, send, getScreen, ws, db) {
  let recovered = 0;
  let failed = 0;
  let consecutiveFails = 0;
  const MAX_CONSECUTIVE_FAILS = 10;

  for (const post of noContentPosts) {
    const postno = post.postno;
    const postnum = parseInt(postno.replace('bbs_chat_', ''));

    // Jump directly to this post number
    send(String(postnum));
    await sleep(500);
    let screen = getScreen();
    if (postnum <= 5) console.log('[recovery] DEBUG after typing num: ' + JSON.stringify(screen.substring(0, 200)));

    // Check if the jump prompt appeared - if not, try pressing Enter
    if (!screen.includes('跳至第幾項')) {
      send('\r');
      await sleep(500);
      screen = getScreen();
      if (postnum <= 5) console.log('[recovery] DEBUG after enter: ' + JSON.stringify(screen.substring(0, 200)));
    }

    // Press Enter to confirm the jump
    send('\r');
    await sleep(3000);
    screen = getScreen();
    if (postnum <= 5) console.log('[recovery] DEBUG after jump: ' + JSON.stringify(screen.substring(0, 200)));

    // Check if we're on the post list (still) or inside the post
    const postsOnScreen = extractPostsOnScreen(screen);
    const isOnPost = !screen.includes('文章列表') && !screen.includes('看板《');

    if (postsOnScreen.length > 0 && !postsOnScreen.find(p => p.postno === String(postnum))) {
      // Cursor jumped to a different post - might be deleted or different position
      console.log('[recovery] ! ' + postnum + ': jump landed on wrong post (not in list), skipping');
      failed++;
      consecutiveFails++;
    } else if (screen.includes('時間:') || isOnPost) {
      // We're inside a post - extract content
      const content = extractContent(screen);

      if (content.length > 10) {
        try {
          updatePost.run(content, postno);
          console.log('[recovery] OK ' + postnum + ': ' + content.substring(0, 50).replace(/\n/g, ' '));
          recovered++;
          consecutiveFails = 0;
        } catch (e) {
          console.log('[recovery] FAIL ' + postnum + ': ' + e.message);
          failed++;
          consecutiveFails++;
        }
      } else {
        console.log('[recovery] -- ' + postnum + ': (no content extracted)');
        failed++;
        consecutiveFails++;
      }

      // Go back to post list
      send('q');
      await sleep(1000);
    } else {
      // Jump might not have worked - try once more with #
      send('#' + postnum + '\r');
      await sleep(2000);
      screen = getScreen();

      if (screen.includes('時間:')) {
        const content = extractContent(screen);
        if (content.length > 10) {
          try {
            updatePost.run(content, postno);
            console.log('[recovery] OK2 ' + postnum + ': ' + content.substring(0, 50).replace(/\n/g, ' '));
            recovered++;
            consecutiveFails = 0;
          } catch (e) {
            failed++;
            consecutiveFails++;
          }
        } else {
          failed++;
          consecutiveFails++;
        }
        send('q');
        await sleep(1000);
      } else {
        console.log('[recovery] ?? ' + postnum + ': (could not access post)');
        try { markBad.run(postno); } catch {}
        failed++;
        consecutiveFails++;
        send('q');
        await sleep(500);
      }
    }

    // Check for consecutive failures (might be at end of list or deleted range)
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      console.log('[recovery] Too many consecutive failures - restarting to refresh connection...');
      ws.close();
      return;
    }

    // Small delay between posts
    await sleep(200);
  }

  console.log('[recovery] Done! Recovered: ' + recovered + ', Failed: ' + failed);
  ws.close();
}

main().catch(err => {
  console.error('[recovery] Fatal: ' + err.message);
  setTimeout(() => main(), 5000);
});
