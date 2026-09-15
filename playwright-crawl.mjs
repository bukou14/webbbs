/**
 * Playwright BBS Crawler
 *
 * Uses a real browser to log into the BBS terminal (bypassing K.O. game issue),
 * navigate to the target board, and scrape posts from the rendered terminal screen.
 *
 * Usage: node playwright-crawl.mjs
 */

import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import iconv from 'iconv-lite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BBS_WS_URL = 'ws://localhost:8080'; // Proxy adds Origin header
const CREDENTIALS = { username: process.env.BBS_USER || '', password: process.env.BBS_PASS || '' };

const BOARD_NAVIGATION = ['B', 's']; // B = 佈告討論區, s = search Chat

function decodeBytes(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  try {
    return iconv.decode(buf, 'big5').replace(/\uFFFD+/g, ' ').trim();
  } catch {
    return buf.toString('ascii').replace(/[^\x20-\x7E]/g, '');
  }
}

function parsePostListRaw(text) {
  const items = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const cleanLine = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const match = cleanLine.match(/^\s*(\d+)\s+([~+M=sS!◇◆])\s*(.*)$/);
    if (!match) continue;
    const postNum = match[1];
    let remainder = match[3];
    const dateMatch = remainder.match(/\d{1,2}\/\d{1,2}(?:\/\d{1,2})?\s*$/);
    if (dateMatch) {
      remainder = remainder.substring(0, remainder.lastIndexOf(dateMatch[0])).trim();
    }
    const parts = remainder.split(/\s{2,}/);
    let title = parts[0].trim();
    if (!title) title = remainder.trim();
    let author = parts.length > 1 ? parts[1].trim() : '';
    if (author.length > 20) { title = remainder.trim(); author = ''; }
    items.push({ postno: postNum, title, author });
  }
  return items;
}

async function waitFor(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('[playwright] Starting BBS crawl via browser...');

  const db = new Database(join(__dirname, 'data', 'webbbs.db'));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Capture all console messages
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser error]', msg.text());
  });

  try {
    // Navigate to the proxy (which serves as the BBS WebSocket endpoint)
    // The page will display the BBS terminal via xterm.js
    console.log('[playwright] Connecting to BBS terminal...');
    await page.goto(`http://localhost:8080`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitFor(2000);

    // Check if we can access the __bbsCrawl API from the page
    const hasApi = await page.evaluate(() => typeof window.__bbsCrawl !== 'undefined');
    console.log('[playwright] __bbsCrawl API available:', hasApi);

    if (!hasApi) {
      // Try connecting directly via WebSocket in the page context
      console.log('[playwright] No __bbsCrawl API — using direct WebSocket approach...');

      // We'll use page.evaluate to run WebSocket code in the browser context
      const result = await page.evaluate(async (creds) => {
        return new Promise((resolve, reject) => {
          let buffer = '';
          let ws = null;
          let enterSent = false;
          let loggedIn = false;
          let postList = [];

          const timeout = setTimeout(() => {
            if (ws) ws.close();
            reject(new Error('Crawl timeout after 60s'));
          }, 60000);

          const doLogin = () => {
            const send = (text) => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                const arr = new Uint8Array(text.length);
                for (let i = 0; i < text.length; i++) arr[i] = text.charCodeAt(i) & 255;
                ws.send(arr.buffer);
              }
            };

            const sendEnter = () => {
              const arr = new Uint8Array(1);
              arr[0] = 13; // \r
              ws.send(arr.buffer);
            };

            const checkBuffer = () => {
              if (buffer.includes('請輸入勇者代號：')) {
                console.log('[WS] Username prompt found!');
                send(creds.username + '\r');
                setTimeout(checkBuffer, 500);
              } else if (buffer.includes('請輸入勇者密碼：')) {
                console.log('[WS] Password prompt found!');
                send(creds.password + '\r');
                setTimeout(checkBuffer, 500);
              } else if (buffer.includes('您想刪除其他重複的 login')) {
                console.log('[WS] Duplicate login, pressing Y');
                send('Y\r');
                setTimeout(checkBuffer, 500);
              } else if (buffer.includes('精華公佈欄') || buffer.includes('任意鍵繼續')) {
                console.log('[WS] Login successful or at menu!');
                send('\r');
                setTimeout(() => {
                  // Navigate: R -> Enter -> B -> s
                  send('R\r');
                  setTimeout(() => {
                    send('\r');
                    setTimeout(() => {
                      send('B\r');
                      setTimeout(() => {
                        send('s\r');
                        setTimeout(() => {
                          console.log('[WS] At board, buffer length:', buffer.length);
                          // Parse posts from buffer
                          const lines = buffer.split('\n');
                          const posts = [];
                          for (const line of lines) {
                            const clean = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
                            const m = clean.match(/^\s*(\d+)\s+([~+M=sS!◇◆])\s*(.*)$/);
                            if (m) {
                              const postno = m[1];
                              let remainder = m[3];
                              const dateMatch = remainder.match(/\d{1,2}\/\d{1,2}(?:\/\d{1,2})?\s*$/);
                              if (dateMatch) remainder = remainder.substring(0, remainder.lastIndexOf(dateMatch[0])).trim();
                              const parts = remainder.split(/\s{2,}/);
                              let title = parts[0].trim() || remainder.trim();
                              let author = parts.length > 1 ? parts[1].trim() : '';
                              if (author.length > 20) { title = remainder.trim(); author = ''; }
                              posts.push({ postno, title, author });
                            }
                          }
                          ws.close();
                          resolve({ posts, buffer: buffer.slice(-2000) });
                        }, 2000);
                      }, 2000);
                    }, 2000);
                  }, 2000);
                }, 2000);
              } else if (buffer.includes('Champion') || buffer.includes('[ＫＯ]')) {
                // In K.O. game, send enter to dismiss
                sendEnter();
                setTimeout(checkBuffer, 1000);
              } else {
                if (!loggedIn) {
                  // Try sending enter to advance past any initial screen
                  if (!enterSent) { sendEnter(); enterSent = true; }
                  setTimeout(checkBuffer, 1000);
                }
              }
            };

            setTimeout(checkBuffer, 1000);
          };

          ws = new WebSocket('ws://localhost:8080');
          ws.binaryType = 'arraybuffer';

          ws.onopen = () => {
            console.log('[WS] Connected to proxy');
          };

          ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              const uint8 = new Uint8Array(event.data);
              // Decode as big5 using TextDecoder (browser built-in)
              const decoder = new TextDecoder('big5');
              const text = decoder.decode(uint8).replace(/\uFFFD/g, ' ');
              buffer += text;
            }
          };

          ws.onerror = () => reject(new Error('WebSocket error'));
          ws.onclose = () => {
            clearTimeout(timeout);
            if (!loggedIn) reject(new Error('WebSocket closed before login'));
          };

          ws.onopen = () => {
            console.log('[WS] Connected, waiting for prompt...');
            setTimeout(doLogin, 2000);
          };
        });
      }, CREDENTIALS);

      console.log('[playwright] Posts found via WebSocket:', result.posts.length);
      console.log('[playwright] Buffer preview:', result.buffer.substring(0, 300));

      // Save posts to DB
      const insertPost = db.prepare(`
        INSERT OR REPLACE INTO posts (postno, board, title, author, date, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const post of result.posts) {
        try {
          insertPost.run(`playwright_${post.postno}`, 'chat', post.title, post.author, '', '');
          console.log(`[playwright] Saved: ${post.postno} - ${post.title.substring(0, 40)}`);
        } catch (e) {
          console.log(`[playwright] Save error: ${e.message}`);
        }
      }
    } else {
      // Use the __bbsCrawl API directly
      console.log('[playwright] Using __bbsCrawl API...');
      await page.evaluate(async (creds) => {
        const api = window.__bbsCrawl;
        await api.connect();
        console.log('[__bbsCrawl] Connected');
        await api.waitFor('請輸入勇者代號：');
        await api.sendText(creds.username + '\r');
        await api.waitFor('請輸入勇者密碼：');
        await api.sendText(creds.password + '\r');
        // Handle duplicate login
        try {
          await api.waitFor('您想刪除其他重複的 login', 3000);
          await api.sendText('Y\r');
        } catch {}
        await api.waitFor('精華公佈欄', 10000);
        await api.sendText('\r');
        // Navigate: R, Enter, B, s
        await api.waitFor('看板列表', 10000);
        await api.sendText('R\r');
        await api.waitFor('精華公佈欄', 10000);
        await api.sendText('\r');
        await api.waitFor('佈告討論區', 10000);
        await api.sendText('B\r');
        await api.waitFor('chat', 5000);
        await api.sendText('s\r');
        await api.waitFor('Chat', 5000);
        const text = api.getTerminalText();
        console.log('[__bbsCrawl] Terminal text length:', text.length);
        window.__bbsTerminalText = text;
      }, CREDENTIALS);

      const terminalText = await page.evaluate(() => window.__bbsTerminalText || '');
      console.log('[playwright] Terminal text length:', terminalText.length);
    }

  } catch (err) {
    console.error('[playwright] Error:', err.message);
  } finally {
    await browser.close();
  }

  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE board = ?').get('chat').count;
  console.log(`[playwright] Done. Total posts in DB: ${total}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[playwright] Fatal error:', err.message);
  process.exit(1);
});
