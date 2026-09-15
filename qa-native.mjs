/**
 * Live QA for the web-native BBS shell.
 * Drives the real BBS through the new native UI and screenshots each page.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const OUT = '/home/galaxy14/project/webbbs/qa-native';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageState(page) {
  return page.evaluate(() => {
    if (document.querySelector('.bbs-login')) return 'login';
    if (document.querySelector('.bbs-menu-list')) return 'menu';
    if (document.querySelector('.bbs-article')) return 'article';
    if (document.querySelector('.bbs-table')) {
      return document.querySelector('.bbs-cell-postno') ? 'postList' : 'boardList';
    }
    if (document.querySelector('.bbs-notice')) return 'notice';
    if (document.querySelector('.bbs-text')) return 'text';
    return 'unknown';
  });
}

async function screenText(page) {
  return page.evaluate(() => {
    const el =
      document.querySelector('.bbs-text-body') ||
      document.querySelector('.bbs-notice-body') ||
      document.querySelector('.bbs-article-body') ||
      document.querySelector('.bbs-body');
    return (el?.textContent || '').replace(/\u00a0/g, ' ').slice(0, 2000);
  });
}

let shot = 0;
async function snap(page, state) {
  shot++;
  const name = `${String(shot).padStart(2, '0')}-${state}.png`;
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(`[qa] shot ${name}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await sleep(800);
await page.locator('.bbs-toolbar-primary').click();
console.log('[qa] clicked Connect');

const seen = new Set();
const handled = { menu: false, boardList: false, postList: false, article: false };
let lastKind = '';

for (let i = 0; i < 90; i++) {
  await sleep(1500);
  const state = await pageState(page);

  if (state !== lastKind) {
    lastKind = state;
    console.log(`[qa] state=${state}`);
    writeFileSync(`${OUT}/${String(i).padStart(2, '0')}-${state}.txt`, await screenText(page));
  }

  if (
    (state === 'menu' || state === 'boardList' || state === 'postList' || state === 'article') &&
    !seen.has(state)
  ) {
    seen.add(state);
    await snap(page, state);
  }

  if (state === 'login') {
    const label = await page.locator('.bbs-field-label').first().textContent();
    const value = (label || '').includes('密碼')
      ? process.env.BBS_PASS || ''
      : process.env.BBS_USER || '';
    await page.locator('.bbs-input').first().fill(value);
    await page.getByRole('button', { name: '送出' }).click();
    console.log(`[qa] login ${label?.trim()} → ${value}`);
    await sleep(1200);
  } else if (state === 'notice') {
    const btn = page.locator('.bbs-notice button').first();
    if (await btn.count()) await btn.click();
    else await page.keyboard.press('Enter');
    await sleep(1200);
  } else if (state === 'text') {
    const body = await screenText(page);
    await page.keyboard.press(/結束|瀏覽 P\./.test(body) ? 'q' : ' ');
    await sleep(900);
  } else if (state === 'menu' && !handled.menu) {
    handled.menu = true;
    await page.locator('.bbs-menu-item', { hasText: '佈告討論區' }).first().click();
    console.log('[qa] menu → 佈告討論區');
    await sleep(1500);
  } else if (state === 'boardList' && !handled.boardList) {
    handled.boardList = true;
    const rows = page.locator('.bbs-row');
    console.log(`[qa] board rows=${await rows.count()}`);
    const search = page.locator('.bbs-search-input').first();
    await search.click();
    await search.fill('chat');
    await search.press('Enter');
    console.log('[qa] board search → chat');
    await sleep(2000);
  } else if (state === 'postList' && !handled.postList) {
    handled.postList = true;
    const rows = page.locator('.bbs-row');
    console.log(`[qa] post rows=${await rows.count()}`);
    await rows.first().click();
    console.log('[qa] post → row 0');
    await sleep(1500);
    if ((await pageState(page)) === 'postList') {
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowRight');
      console.log('[qa] post → arrow retry');
    }
  }

  if (handled.article) break;
}

console.log('[qa] states seen:', [...seen].join(',') || '(none)');
await browser.close();
