/**
 * Targeted BBS Recovery Crawler
 *
 * Uses Playwright to bypass the 0x66 byte-stripping login blocker.
 * Jumps directly to each missing post using the BBS #<postno> command,
 * extracts content, and saves to the DB.
 *
 * Usage: node playwright-recover.mjs
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
const BATCH_SIZE = 20; // Posts per browser session before restart

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function recoverPosts() {
  const db = new Database(join(__dirname, '..', 'data', 'webbbs.db'));

  const updatePost = db.prepare(`UPDATE posts SET content = ? WHERE postno = ?`);
  const markBad = db.prepare(`INSERT OR IGNORE INTO bad_posts (postno) VALUES (?)`);

  // Get missing posts ordered by post number
  const missing = db.prepare(`
    SELECT postno FROM posts
    WHERE (content IS NULL OR content = '')
    AND postno NOT IN (SELECT postno FROM bad_posts)
    ORDER BY CAST(SUBSTR(postno, 10) AS INTEGER)
  `).all();

  console.log(`[recover] Found ${missing.length} posts to recover`);
  if (missing.length === 0) {
    console.log('[recover] Nothing to do!');
    process.exit(0);
  }

  let recovered = 0;
  let failed = 0;
  let batchNum = 0;

  // Process in batches
  while (batchNum * BATCH_SIZE < missing.length) {
    const batch = missing.slice(batchNum * BATCH_SIZE, (batchNum + 1) * BATCH_SIZE);
    batchNum++;
    console.log(`\n[recover] === Batch #${batchNum} (${batch.length} posts) ===`);

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(30000);

      // Step 1: Navigate to BBS terminal
      console.log('[recover] Navigating to BBS terminal...');
      await page.goto(BBS_URL, { waitUntil: 'domcontentloaded' });
      await sleep(2000);

      const inputSelector = '#t';

      // Step 2: Wait for login prompt
      await page.waitForSelector(inputSelector, { timeout: 10000 });
      await page.waitForFunction(
        () => document.querySelector('#BBSWindow')?.innerText?.includes('請輸入勇者代號'),
        { timeout: 15000 }
      );
      console.log('[recover] Login prompt found!');

      // Step 3: Enter username
      await page.locator(inputSelector).fill(CREDENTIALS.username);
      await page.locator(inputSelector).press('Enter');
      await sleep(2000);

      // Step 4: Wait for password prompt
      await page.waitForFunction(
        () => document.querySelector('#BBSWindow')?.innerText?.includes('勇者密碼'),
        { timeout: 15000 }
      );
      console.log('[recover] Password prompt found!');

      // Step 5: Enter password
      await page.locator(inputSelector).fill(CREDENTIALS.password);
      await page.locator(inputSelector).press('Enter');
      await sleep(2000);

      // Step 6: Dismiss any-key prompts -> board list
      const getText = () => page.evaluate(() => document.querySelector('#BBSWindow')?.innerText || '');

      console.log('[recover] Navigating to board list...');
      for (let i = 0; i < 8; i++) {
        const text = await getText();
        if (text.includes('【看板列表】')) {
          console.log('[recover] At board list!');
          break;
        }
        if (text.includes('請按任意鍵') || text.includes('任意鍵')) {
          await page.locator(inputSelector).press('Enter');
          await sleep(1200);
        } else {
          await page.locator(inputSelector).press('Enter');
          await sleep(200);
        }
      }

      // Step 7: Navigate to Chat board
      console.log('[recover] Navigating to Chat board...');
      const CHAT_POSITION = 44;
      for (let i = 0; i < CHAT_POSITION; i++) {
        await page.keyboard.press('ArrowDown');
        await sleep(60);
      }
      await page.keyboard.press('ArrowRight');
      await sleep(2000);
      await page.keyboard.press('ArrowRight');
      await sleep(4000);

      const boardText = await getText();
      if (!boardText.includes('Chat')) {
        console.log('[recover] Warning: May not be at Chat board');
      } else {
        console.log('[recover] Successfully at Chat board!');
      }

      // Process each post in the batch
      for (const row of batch) {
        const postno = row.postno;
        const postnum = parseInt(postno.replace('bbs_chat_', ''), 10);
        console.log(`[recover] Jumping to #${postnum}...`);

        // Type #<postno> to jump directly to post
        await page.locator(inputSelector).type(`#${postnum}`, { delay: 50 });
        await page.locator(inputSelector).press('Enter');
        await sleep(3000);

        // Extract content
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
        } catch (e) {
          console.log(`[recover] ! ${postnum}: extract error: ${e.message.substring(0, 40)}`);
        }

        if (contentText.length > 10) {
          try {
            updatePost.run(contentText, postno);
            console.log(`[recover] ✓ ${postnum}: ${contentText.substring(0, 40).replace(/\n/g, '|')}`);
            recovered++;
          } catch (e) {
            console.log(`[recover] ✗ ${postnum}: db error: ${e.message.substring(0, 40)}`);
          }
        } else {
          // No content extracted - might be bad post or need to scroll
          try {
            markBad.run(postno);
            console.log(`[recover] - ${postnum}: no content (marked bad)`);
          } catch {}
          failed++;
        }

        // Return to post list
        try {
          await page.keyboard.press('q');
          await sleep(1000);
        } catch {
          try {
            await page.keyboard.press('Escape');
            await sleep(1000);
          } catch {}
        }
      }

    } catch (err) {
      console.error('[recover] Batch error:', err.message);
    } finally {
      await browser.close();
    }

    // Report progress
    const stats = db.prepare("SELECT COUNT(*) as c FROM posts WHERE content IS NOT NULL AND content != ''").get();
    console.log(`\n[recover] Batch done. Running total: ${stats.c} posts with content`);
  }

  // Final stats
  const finalStats = db.prepare("SELECT COUNT(*) as c FROM posts WHERE content IS NOT NULL AND content != ''").get();
  console.log(`\n[recover] === Recovery complete ===`);
  console.log(`[recover] Posts now with content: ${finalStats.c}`);
  console.log(`[recover] This run: ${recovered} recovered, ${failed} failed`);

  db.close();
  process.exit(0);
}

recoverPosts().catch(err => {
  console.error('[recover] Fatal:', err.message);
  process.exit(1);
});
