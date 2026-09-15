const WebSocket = require('ws');
const iconv = require('iconv-lite');
const { Terminal } = require('@xterm/headless');

const WS_URL = 'wss://term.gamer.com.tw/bbs';
const DB_PATH = '/home/galaxy14/project/webbbs/data/webbbs.db';
const BOARD = 'chat';
const USERNAME = process.env.BBS_USER || '';
const PASSWORD = process.env.BBS_PASS || '';

let ws, term, db;
let state = 'CONNECTING';
let loginTimer = null;
let msgCount = 0;

const send = (str) => ws.send(iconv.encode(str, 'big5'));
const sendBytes = (bytes) => ws.send(Buffer.from(bytes));

const getScreen = () => {
  let lines = [];
  for (let i = 0; i < term.rows; i++) {
    const line = term.buffer.active.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  db = new Database(DB_PATH);

  term = new Terminal({ rows: 24, cols: 80, allowProposedApi: true });
  term.resize(80, 24);

  ws = new WebSocket(WS_URL, { origin: 'https://term.gamer.com.tw', protocol: 'telnet' });

  ws.on('open', () => {
    console.log('[recovery] Connected, waiting for splash...');
    setTimeout(tryLogin, 8000);
  });

  ws.on('message', (data) => {
    msgCount++;
    const text = iconv.decode(Buffer.isBuffer(data) ? data : Buffer.from(data), 'big5');
    term.write(text);
    const s = getScreen();
    handleState(s);
  });

  ws.on('close', () => {
    console.log('[recovery] Connection closed');
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error('[recovery] WS Error:', err.message);
    ws.close();
  });
}

function tryLogin() {
  const s = getScreen();
  console.log('[recovery] Login attempt, screen preview:', JSON.stringify(s.substring(0, 80)));

  // Check if we're at login prompt
  if (s.includes('請輸入勇者代號') || s.includes('勇者代號')) {
    console.log('[recovery] At login ID prompt, sending username byte-by-byte...');

    // Try sending username character by character to avoid byte stripping
    const usernameChars = USERNAME.split('');
    let delay = 0;
    for (const char of usernameChars) {
      setTimeout(() => {
        send(char);
      }, delay);
      delay += 300; // 300ms between each character
    }
    // Send \r after all characters
    setTimeout(() => {
      send('\r');
      console.log('[recovery] Username sent, waiting for password prompt...');
      // Wait for password prompt
      loginTimer = setTimeout(checkPassword, 8000);
    }, delay);
  } else if (s.includes('錯誤的使用者代號')) {
    console.log('[recovery] Login failed - bad username, trying different approach...');
    ws.close();
  } else {
    console.log('[recovery] Not at login prompt, dismissing...');
    send('\r');
    setTimeout(tryLogin, 3000);
  }
}

function checkPassword() {
  const s = getScreen();
  if (s.includes('請輸入密碼') || s.includes('密碼')) {
    console.log('[recovery] Got password prompt!');
    send(PASSWORD + '\r');
    setTimeout(checkWelcome, 5000);
  } else if (s.includes('錯誤的使用者代號')) {
    console.log('[recovery] Username rejected - checking if f was stripped...');
    // Check screen for ai14 (f was stripped)
    if (s.includes('ai14')) {
      console.log('[recovery] Username sent (first char check only), waiting for password prompt...');
    }
    ws.close();
  } else {
    console.log('[recovery] No password prompt, retrying login...');
    setTimeout(tryLogin, 2000);
  }
}

function checkWelcome() {
  const s = getScreen();
  if (s.includes('Main Menu') || s.includes('主功能表') || s.includes('A)nnounce')) {
    console.log('[recovery] Login successful!');
    goToBoard();
  } else if (s.includes('請按任意鍵') || s.includes('任意鍵')) {
    console.log('[recovery] Dismiss welcome...');
    send('\r');
    setTimeout(checkWelcome, 2000);
  } else {
    console.log('[recovery] Still at welcome, waiting...');
    setTimeout(checkWelcome, 2000);
  }
}

async function goToBoard() {
  console.log('[recovery] Going to board list...');
  send('b\r');
  await sleep(3000);

  let attempts = 0;
  while (attempts < 10) {
    const s = getScreen();
    if (s.includes('請輸入看板名稱') || s.includes('輸入看板名稱')) {
      console.log('[recovery] At board search, searching for Chat...');
      send('sChat\r');
      await sleep(3000);
      break;
    }
    send('\r');
    await sleep(1000);
    attempts++;
  }

  // Dismiss any splash/featured section
  attempts = 0;
  while (attempts < 5) {
    const s = getScreen();
    if (s.includes('精華') || s.includes('《尚未選定》')) {
      console.log('[recovery] In 精華區, pressing Left...');
      send('\x1b[D');
      await sleep(1500);
      attempts++;
      continue;
    }
    if (s.includes('文章列表') || s.includes('Chat')) {
      console.log('[recovery] In Chat board!');
      recoverPosts();
      return;
    }
    send('\r');
    await sleep(1000);
    attempts++;
  }
  console.log('[recovery] Could not enter Chat board');
  ws.close();
}

async function recoverPosts() {
  // Get posts missing content from DB
  const missing = db.prepare(
    "SELECT postno, title, author, date FROM posts WHERE board = ? AND (content IS NULL OR content = '') ORDER BY CAST(postno AS INTEGER)"
  ).all(BOARD);

  console.log('[recovery] Posts missing content:', missing.length);

  if (missing.length === 0) {
    console.log('[recovery] No posts to recover!');
    ws.close();
    return;
  }

  // Try jumping to first post
  const first = missing[0];
  const postno = first.postno.replace('bbs_chat_', '');
  console.log('[recovery] Attempting to jump to post', postno, ':', first.title.substring(0, 40));

  // Try '#' command to jump to post number
  send('#' + postno + '\r');
  await sleep(5000);

  let s = getScreen();
  console.log('[recovery] After jump attempt, screen preview:', JSON.stringify(s.substring(0, 100)));

  if (s.includes('標題:') || s.includes('時間:')) {
    console.log('[recovery] Successfully entered post!');
    const content = extractContent(s);
    console.log('[recovery] Content length:', content.length);
    if (content.length > 10) {
      db.prepare('UPDATE posts SET content = ? WHERE postno = ?').run(content, first.postno);
      console.log('[recovery] Updated post', postno);
    }
  } else {
    console.log('[recovery] Jump did not work, trying PageUp to navigate...');
    // Try PageUp to go to newest, then work backwards
    send('\x1b[5~');
    await sleep(3000);
    s = getScreen();
    console.log('[recovery] After PageUp, preview:', JSON.stringify(s.substring(0, 100)));
  }

  console.log('[recovery] Recovery complete for now.');
  ws.close();
}

function extractContent(screen) {
  // Simple content extraction from post screen
  const lines = screen.split('\n');
  let content = [];
  let inContent = false;

  for (const line of lines) {
    if (line.includes('標題:') || line.includes('時間:') || line.includes('作者:')) {
      inContent = true;
      continue;
    }
    if (line.includes('─────────────────────────────────') || line.includes('==========')) {
      continue;
    }
    if (line.trim() === '' && content.length > 5) {
      inContent = false;
      break;
    }
    if (inContent && line.trim()) {
      content.push(line.trim());
    }
  }
  return content.join('\n');
}

function handleState(screen) {
  // Minimal state handling for recovery
  switch (state) {
    case 'CONNECTING':
      if (screen.includes('請輸入勇者代號') || screen.includes('勇者代號')) {
        state = 'LOGIN_ID';
        tryLogin();
      }
      break;
  }
}

// Require Database
const Database = require('better-sqlite3');

main().catch(e => {
  console.error('[recovery] Error:', e);
  process.exit(1);
});

setTimeout(() => {
  console.log('[recovery] Timeout');
  process.exit(0);
}, 120000);
