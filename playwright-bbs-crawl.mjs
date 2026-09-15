/**
 * Playwright BBS Crawler - Complete Solution
 *
 * Uses Playwright to automate a real browser login to the BBS terminal.
 * Navigates from oldest posts (Home) forward through time (PageDown).
 * Auto-restarts on browser crash to continue through all 70K posts.
 *
 * Usage: node playwright-bbs-crawl.mjs
 */

import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BBS_URL = 'https://term.gamer.com.tw/';
const CREDENTIALS = { username: process.env.BBS_USER || '', password: process.env.BBS_PASS || '' };
const BOARD = 'chat';
const BOARD_URL = 'https://forum.gamer.com.tw/B.php?bsn=23839&subbsn=0';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Convert BBS date format to ISO date string
// Modern: "07/13" -> "2026-07-13" (current year)
// Old (mYYMM/DD): "m9901/21" -> "2010-01-21" (民國年月)
function parseBBSDate(dateStr) {
  if (dateStr.startsWith('m')) {
    const yyyymm = dateStr.substring(1, 6);
    const dd = dateStr.substring(7, 9);
    const yy = parseInt(yyyymm.substring(0, 2), 10);
    const mm = parseInt(yyyymm.substring(2, 4), 10);
    const year = 1911 + yy;
    return `${year}-${String(mm).padStart(2, '0')}-${dd}`;
  } else {
    const [mm, dd] = dateStr.split('/');
    return `2026-${mm}-${dd}`;
  }
}

async function main() {
  console.log('[playwright] Starting Playwright BBS crawl...');

  const db = new Database(join(__dirname, 'data', 'webbbs.db'));

  // Check if post exists AND has content (retry empty posts instead of skipping)
  const postExistsStmt = db.prepare(`SELECT postno FROM posts WHERE postno = ? AND content IS NOT NULL AND content != ''`);
  const insertPostStmt = db.prepare(`INSERT INTO posts (postno, board, title, author, date, content) VALUES (?, ?, ?, ?, ?, ?)`);
  const updatePostStmt = db.prepare(`UPDATE posts SET content = ? WHERE postno = ?`);
  const markBadStmt = db.prepare(`INSERT OR IGNORE INTO bad_posts (postno) VALUES (?)`);
  const getBad = db.prepare(`SELECT postno FROM bad_posts`).all().map(r => r.postno);
  const badPosts = new Set(getBad);
  console.log(`[playwright] Loaded ${badPosts.size} bad-post skip-list from DB`);

  // Track cursor position on post list to detect corruption
  let lastPostnoOnScreen = null;
  let skipCount = 0;

  let runCount = 0;

  // Auto-restart on browser crash to continue through all 70K posts
  while (true) {
    runCount++;
    console.log(`[playwright] === Run #${runCount} ===`);

    // Reset visited posts on each run to allow reprocessing of posts with empty content
    const visitedPosts = new Set();

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(30000);

      // Step 1: Navigate to BBS terminal
      console.log('[playwright] Navigating to BBS terminal...');
      await page.goto(BBS_URL, { waitUntil: 'domcontentloaded' });
      await sleep(2000);

      const inputSelector = '#t';
      await page.waitForSelector(inputSelector, { timeout: 10000 });

      // Step 2: Wait for login prompt
      console.log('[playwright] Waiting for login prompt...');
      await page.waitForFunction(
        () => document.querySelector('#BBSWindow')?.innerText?.includes('請輸入勇者代號'),
        { timeout: 15000 }
      );
      console.log('[playwright] Login prompt found!');

      // Step 3: Enter username
      console.log('[playwright] Entering username...');
      await page.locator(inputSelector).fill(CREDENTIALS.username);
      await page.keyboard.press('Enter');
      await sleep(1500);

      // Step 4: Wait for password prompt
      await page.waitForFunction(
        () => document.querySelector('#BBSWindow')?.innerText?.includes('請輸入勇者密碼'),
        { timeout: 10000 }
      );
      console.log('[playwright] Password prompt found!');

      // Step 5: Enter password
      await page.locator(inputSelector).fill(CREDENTIALS.password);
      await page.keyboard.press('Enter');
      await sleep(2000);

      // Step 6: Dismiss any-key prompts -> board list
      const getText = () => page.evaluate(() => document.querySelector('#BBSWindow')?.innerText || '');
      const sampleText = (t, n = 200) => t.substring(0, n).replace(/\n/g, '|');

      console.log('[playwright] Navigating to board list...');
      for (let i = 0; i < 8; i++) {
        const text = await getText();
        console.log(`  [step6:${i}] ${sampleText(text)}`);
        if (text.includes('【看板列表】')) {
          console.log('[playwright] At board list!');
          break;
        }
        if (text.includes('請按任意鍵') || text.includes('任意鍵') || text.includes('請按任意鍵繼續')) {
          await page.keyboard.press('Enter');
          await sleep(1200);
        } else {
          await page.keyboard.press('Enter');
          await sleep(200);
        }
      }

      // Step 7: Navigate to Chat board (position 44 = 45th from 1)
      console.log('[playwright] Navigating to Chat board...');
      const beforeS = await getText();
      console.log(`  [before s] ${sampleText(beforeS)}`);

      const CHAT_POSITION = 44;
      for (let i = 0; i < CHAT_POSITION; i++) {
        await page.keyboard.press('ArrowDown');
        await sleep(60);
      }

      const cursorLine = await page.evaluate(() => {
        const t = document.querySelector('#BBSWindow')?.innerText || '';
        const line = t.split('\n').find(l => l.trim().startsWith('>'));
        return line;
      });
      console.log(`  [cursor] ${cursorLine?.trim().substring(0, 60)}`);

      // Enter Chat board - ArrowRight x 2
      await page.keyboard.press('ArrowRight');
      await sleep(2000);
      await page.keyboard.press('ArrowRight');
      await sleep(4000);

      const boardText = await page.evaluate(() => document.querySelector('#BBSWindow')?.innerText || '');
      if (!boardText.includes('看板《Chat》') && !boardText.includes('Chat')) {
        console.log('[playwright] Warning: May not be at Chat board');
      } else {
        console.log('[playwright] Successfully at Chat board!');
      }

      // Navigate to newest posts first (End key), then work backwards with PageUp
      console.log('[playwright] Going to newest posts (End key)...');
      await page.keyboard.press('End');
      await sleep(5000);

      // Step 9: Read posts from Chat board
      const visitedPosts = new Set();
      let consecutiveNoNewPosts = 0;
      const MAX_CONSECUTIVE_NO_NEW = 3;

      while (true) {
        let posts;
        try {
          posts = await page.evaluate(() => {
            const text = document.querySelector('#BBSWindow')?.innerText || '';
            const lines = text.split('\n');
            const posts = [];
            for (const line of lines) {
              const m = line.match(/^\s*(\d+)\s+(?:([+M=s])\s+)?((?:\d{2}\/\d{2})|m\d{4}\/\d{2})\s+(\S+)\s+(.+)$/);
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
          });
        } catch (e) {
          // Page crashed - try PageDown to recover
          console.log(`[playwright] Page read error: ${e.message.substring(0, 50)}. Trying PageDown...`);
          try {
            await page.keyboard.press('PageDown');
            await sleep(3000);
            continue;
          } catch {
            break;
          }
        }
        console.log(`[playwright] Found ${posts.length} posts on screen`);

        if (posts.length === 0) break;

        const newPostsOnPage = posts.filter(p => !visitedPosts.has(`bbs_${BOARD}_${p.postno}`)).length;

        if (newPostsOnPage === 0) {
          consecutiveNoNewPosts++;
          if (consecutiveNoNewPosts >= MAX_CONSECUTIVE_NO_NEW) {
            console.log('[playwright] No new posts on consecutive pages - end of list');
            break;
          }
        } else {
          consecutiveNoNewPosts = 0;
        }

        // Save posts to DB and read content
        for (const post of posts) {
          const bbsPostno = `bbs_${BOARD}_${post.postno}`;

          // Skip already-visited and known-bad posts
          if (visitedPosts.has(bbsPostno) || badPosts.has(bbsPostno)) {
            try {
              await page.keyboard.press('ArrowDown');
              await sleep(150);
            } catch {}
            continue;
          }

          // If we see the same postno twice in a row, skip forward
          if (post.postno === lastPostnoOnScreen) {
            skipCount++;
            if (skipCount > 3) {
              console.log(`[playwright] Stuck on post ${post.postno} — pressing PageDown to advance`);
              await page.keyboard.press('PageDown');
              await sleep(2000);
              skipCount = 0;
            }
            try { await page.keyboard.press('ArrowDown'); await sleep(150); } catch {}
            continue;
          }
          lastPostnoOnScreen = post.postno;
          skipCount = 0;

          visitedPosts.add(bbsPostno);

          // Only create post if it doesn't already exist in DB (prevents empty posts on crash)
          if (!postExistsStmt.get(bbsPostno)) {
            try {
              insertPostStmt.run(bbsPostno, BOARD, post.title, post.author, parseBBSDate(post.date), '');
            } catch {}
          }

          // Navigate to post — ArrowRight x 2
          let enteredPost = false;
          try {
            await page.keyboard.press('ArrowRight');
            await sleep(1000);
            await page.keyboard.press('ArrowRight');
            await sleep(1500);
            enteredPost = true;
          } catch (e) {
            console.log(`[playwright] ! ${post.postno}: (enter failed: ${e.message.substring(0, 30)})`);
            try { await page.keyboard.press('Escape'); await sleep(800); } catch {}
          }

          // Extract content only if we successfully entered the post
          if (enteredPost) {
            let contentText = '';
            try {
              contentText = await page.evaluate(() => {
                const text = document.querySelector('#BBSWindow')?.innerText || '';
                const lines = text.split('\n');
                let contentLines = [];
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
                  if (foundTime && line.includes('文章選讀')) {
                    break;
                  }
                  if (foundTime && !foundDashDash && line.trim()) {
                    contentLines.push(line.trim());
                  }
                }
                return contentLines.join('\n');
              });
            } catch {}

            if (contentText.length > 10) {
              try {
                updatePostStmt.run(contentText, bbsPostno);
                console.log(`[playwright] ✓ ${post.postno}: ${post.title.substring(0, 30)}`);
              } catch (e) {
                console.log(`[playwright] ✗ ${post.postno}: ${e.message}`);
              }
            } else {
              console.log(`[playwright] - ${post.postno}: (no content)`);
            }

            // Go back to post list
            try {
              await page.keyboard.press('q');
              await sleep(1000);
            } catch (e) {
              try {
                await page.keyboard.press('Escape');
                await sleep(1000);
              } catch {}
            }
          } else {
            // Mark as bad and DO NOT press ArrowDown — let next PageDown advance
            try {
              markBadStmt.run(bbsPostno);
              badPosts.add(bbsPostno);
              console.log(`[playwright] → marked bad: ${post.postno}`);
            } catch {}
            // No ArrowDown here — avoids destabilizing the page after bad posts
          }
        }

        // Navigate to previous page (PageUp = older posts, since we start from End/newest)
        try {
          await page.keyboard.press('PageUp');
          await sleep(2500);
        } catch (e) {
          // Browser crashed — try PageDown to recover
          console.log(`[playwright] PageUp crashed: ${e.message.substring(0, 40)}. Trying PageDown to recover...`);
          try {
            await page.keyboard.press('PageDown');
            await sleep(2000);
            continue;
          } catch {
            break;
          }
        }
      }

    } catch (err) {
      console.error('[playwright] Error:', err.message, '| Restarting...');
      try { await browser.close(); } catch {}
    }
    // Loop continues - auto-restart
  }
}

async function fetchForumPosts() {
  const { fetch } = await import('undici');
  const posts = [];

  const response = await fetch(BOARD_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    }
  });

  const html = await response.text();

  const rowMatches = [...html.matchAll(/<tr[^>]+class="b-list__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)];
  for (const row of rowMatches) {
    const rowHtml = row[1];
    const titleMatch = rowHtml.match(/<p[^>]+class="b-list__main__title"[^>]*>([^<]+)<\/p>/);
    const urlMatch = rowHtml.match(/href="(C\.php\?bsn=23839&snA=\d+&tnum=\d+)"/);
    const authorMatch = rowHtml.match(/<a[^>]+class="b-list__main__author"[^>]*>([^<]+)<\/a>/);
    const dateMatch = rowHtml.match(/<td[^>]+class="b-list__time"[^>]*>[\s\S]*?(\d{4}-\d{2}-\d{2})/);

    const title = titleMatch ? titleMatch[1].trim() : '';
    const postUrl = urlMatch ? 'https://forum.gamer.com.tw/' + urlMatch[1] : '';
    const author = authorMatch ? authorMatch[1].trim() : '';
    const date = dateMatch ? dateMatch[1] : '';

    if (!title || title.includes('系統') || !postUrl) continue;

    const snAMatch = postUrl.match(/snA=(\d+)/);
    const tnumMatch = postUrl.match(/tnum=(\d+)/);
    const postno = snAMatch ? `chat_${snAMatch[1]}_${tnumMatch ? tnumMatch[1] : '1'}` : '';

    let content = '';
    if (postUrl) {
      try {
        const resp = await fetch(postUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (resp.ok) {
          const postHtml = await resp.text();
          const contentMatch = postHtml.match(/<div[^>]+class="c-article__content"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/);
          if (contentMatch) {
            content = contentMatch[1]
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
              .replace(/\n{3,}/g, '\n\n').trim();
          }
        }
      } catch {}
    }

    posts.push({ postno, content });
  }

  return posts;
}

main().catch(err => {
  console.error('[playwright] Fatal:', err.message);
  process.exit(1);
});
