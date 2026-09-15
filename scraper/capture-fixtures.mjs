/**
 * Live BBS fixture capture.
 *
 * Connects to Bahamut BBS, logs in, walks menu -> board list -> post list ->
 * article, and dumps the xterm screen (text + per-row dominant background
 * color, used to detect the highlighted/selected row) at each step.
 *
 * Output: scraper/fixtures/NN-name.txt and NN-name.json
 *
 * Usage: node scraper/capture-fixtures.mjs
 */
import WebSocket from 'ws';
import iconv from 'iconv-lite';
import xtermHeadless from '@xterm/headless';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Terminal } = xtermHeadless;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'fixtures');
mkdirSync(OUT, { recursive: true });

const WS_URL = 'wss://term.gamer.com.tw/bbs';
const ORIGIN = 'https://term.gamer.com.tw';
const USER = process.env.BBS_USER || '';
const PASS = process.env.BBS_PASS || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const term = new Terminal({ rows: 24, cols: 80, allowProposedApi: true });
term.resize(80, 24);

let step = 0;
let rawBytes = 0;

function rows() {
  const out = [];
  for (let i = 0; i < term.rows; i++) {
    const line = term.buffer.active.getLine(i);
    if (!line) { out.push(''); continue; }
    out.push(line.translateToString(true));
  }
  return out;
}

function rowColors() {
  const info = [];
  for (let i = 0; i < term.rows; i++) {
    const line = term.buffer.active.getLine(i);
    if (!line) { info.push({ bgMode: 0, bg: 0, fg: 0, bgCount: 0, cells: 0 }); continue; }
    const counts = new Map();
    let cells = 0;
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell) continue;
      cells++;
      const ch = cell.getChars();
      if (!ch || ch === ' ') continue;
      const bgMode = cell.getBgColorMode();
      const bg = cell.getBgColor();
      const key = `${bgMode}:${bg}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let best = '0:0';
    let bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
    const [bm, bc] = best.split(':').map(Number);
    info.push({ bgMode: bm, bg: bc, bgCount: bestN, cells });
  }
  return info;
}

function dump(name) {
  const r = rows();
  const base = `${String(step).padStart(2, '0')}-${name}`;
  writeFileSync(join(OUT, base + '.txt'), r.join('\n'));
  writeFileSync(join(OUT, base + '.json'), JSON.stringify({ rows: r, colors: rowColors() }, null, 1));
  console.log(`[cap] ${base}.txt`);
  step++;
}

const screen = () => rows().join('\n');
const has = (s) => screen().includes(s);

async function waitFor(needles, ms = 15000) {
  const list = Array.isArray(needles) ? needles : [needles];
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = screen();
    if (list.some((n) => s.includes(n))) return true;
    await sleep(250);
  }
  return false;
}

const send = (s) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(iconv.encode(s, 'big5'));
};

const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN }, perMessageDeflate: true });

ws.on('open', () => console.log('[cap] WS open'));
ws.on('error', (e) => console.log('[cap] WS error', e.message));
ws.on('message', (data) => {
  rawBytes += data.length;
  try { term.write(iconv.decode(Buffer.isBuffer(data) ? data : Buffer.from(data), 'big5')); } catch {}
});

async function dismissKoGame(tries = 12) {
  for (let i = 0; i < tries; i++) {
    const s = screen();
    if (s.includes('勇者代號') || s.includes('輸入代號')) return true;
    if (s.includes('Champion') || s.includes('[ＫＯ]') || s.includes('K.O.')) {
      console.log('[cap] K.O. game detected, Enter');
      send('\r');
      await sleep(1200);
      continue;
    }
    await sleep(400);
  }
  return screen().includes('勇者代號');
}

async function anyKeyDismiss(max = 6) {
  for (let i = 0; i < max; i++) {
    const s = screen();
    if (s.includes('主功能表') || s.includes('A)nnounce') || s.includes('精華公佈欄')) return true;
    send('\r');
    await sleep(1000);
  }
  return false;
}

async function main() {
  const overall = setTimeout(() => { console.log('[cap] GLOBAL TIMEOUT'); finish(1); }, 180000);

  await sleep(2000);
  dump('initial');

  await dismissKoGame();
  dump('after-ko-dismiss');

  if (!(await waitFor('勇者代號', 5000))) {
    console.log('[cap] no username prompt; screen:\n' + screen());
  }
  send(USER + '\r');
  await sleep(1500);
  dump('after-username');

  await waitFor('勇者密碼', 12000);
  send(PASS + '\r');
  await sleep(1500);
  dump('after-password');

  if (has('重複')) { send('Y\r'); await sleep(1200); dump('after-dupe'); }

  await anyKeyDismiss(8);
  // A few extra enters in case of announcements
  send('\r'); await sleep(1200);
  send('\r'); await sleep(1500);
  dump('reached-menu-check');

  await anyKeyDismiss(6);
  dump('main-menu');

  // Try to reach board list. 'b' = 佈告討論區 per scraper; 'r' = 閱讀看板 per menu.
  console.log('[cap] sending b');
  send('b'); await sleep(2500);
  send('\r'); await sleep(2500);
  dump('after-b');

  if (!has('看板列表') && !has('請輸入看板名稱') && !has('BoardList')) {
    console.log('[cap] b did not yield board list; trying r');
    send('r'); await sleep(2500);
    dump('after-r');
  }

  // If a board search prompt is present, search for Chat/chat.
  if (has('請輸入看板名稱') || has('輸入看板名稱')) {
    console.log('[cap] searching board chat');
    send('chat'); await sleep(1200);
    send('\r'); await sleep(3000);
    dump('after-board-search');
  }

  // On the board list, try selecting/entering a board.
  console.log('[cap] trying to enter a board (s then chat)');
  send('s'); await sleep(1500);
  dump('after-s');
  send('chat'); await sleep(1200);
  send('\r'); await sleep(3500);
  dump('after-chat-enter');

  // If we're on a post list, open the first post.
  const onPostList = has('文章列表') || has('標題') || has('作者') || has('板主');
  console.log('[cap] onPostList?', onPostList, 'screen head:', screen().split('\n').slice(0, 3));
  send('\x1b[C'); await sleep(1800);
  send('\x1b[C'); await sleep(2500);
  dump('after-open-post');

  send('\x1b[6~'); await sleep(2500);
  dump('after-pagedown');

  console.log('[cap] raw bytes:', rawBytes);
  finish(0);
}

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 300);
}

main().catch((e) => { console.log('[cap] fatal', e); finish(1); });
