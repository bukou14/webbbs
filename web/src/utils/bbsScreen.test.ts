import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseScreen, type BbsPage } from './bbsScreen';

function fixture(name: string): BbsPage {
  const path = fileURLToPath(new URL(`./__fixtures__/${name}.txt`, import.meta.url));
  const rows = readFileSync(path, 'utf8').split('\n');
  return parseScreen({ rows });
}

describe('bbsScreen parser (live fixtures)', () => {
  it('prefers the login prompt when the K.O. attract screen shares the screen', () => {
    const page = fixture('01-after-ko-dismiss');
    expect(page.kind).toBe('login');
    if (page.kind === 'login') expect(page.field).toBe('username');
  });

  it('detects a K.O. attract screen with no login prompt', () => {
    const path = fileURLToPath(new URL('./__fixtures__/01-after-ko-dismiss.txt', import.meta.url));
    const rows = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !line.includes('勇者') && !line.includes('user.gamer'));
    expect(parseScreen({ rows }).kind).toBe('ko');
  });

  it('detects the system announcement as a notice', () => {
    const page = fixture('03-after-password');
    expect(page.kind).toBe('notice');
    if (page.kind === 'notice') expect(page.title).toContain('系 統 公 告');
  });

  it('detects the visitor-footprints screen as a notice', () => {
    const page = fixture('04-reached-menu-check');
    expect(page.kind).toBe('notice');
    if (page.kind === 'notice') expect(page.title).toContain('過');
  });

  it('parses the main menu with all hotkeys and the cursor', () => {
    const page = fixture('05-main-menu');
    expect(page.kind).toBe('menu');
    if (page.kind !== 'menu') return;
    expect(page.items.map((i) => i.key)).toEqual(['A', 'B', 'C', 'F', 'M', 'T', 'U', 'R', 'G']);
    expect(page.items.find((i) => i.key === 'A')?.label).toBe('精華公佈欄');
    expect(page.items.find((i) => i.key === 'B')?.label).toBe('佈告討論區');
    expect(page.items[page.selectedIndex].key).toBe('B');
    expect(page.header.title).toBe('主功能表');
  });

  it('parses the board list with status glyphs, moderators and cursor', () => {
    const page = fixture('06-after-b');
    expect(page.kind).toBe('boardList');
    if (page.kind !== 'boardList') return;
    expect(page.items.length).toBeGreaterThanOrEqual(20);
    const first = page.items[0];
    expect(first.name).toBe('Abuse');
    expect(first.status).toBe('◎');
    expect(first.moderator).toBe('Abuse');
    expect(first.selected).toBe(true);
    expect(page.items[1].name).toBe('Accessory');
    expect(page.items[1].moderator).toBe('lichih');
    expect(page.header.board).toBe('尚未選定');
  });

  it('captures the board-name search prompt', () => {
    const page = fixture('07-after-s');
    expect(page.kind).toBe('boardList');
    if (page.kind === 'boardList') expect(page.prompt).toContain('請輸入看板名稱');
  });

  it('detects a search input prompt', () => {
    const page = parseScreen({ rows: ['', '  搜尋標題：          ', ''] });
    expect(page.kind).toBe('prompt');
    if (page.kind === 'prompt') expect(page.prompt).toContain('搜尋標題');
  });

  it('detects a yes/no option prompt', () => {
    const page = parseScreen({ rows: ['限定有m標記的文章? [y/N]：'] });
    expect(page.kind).toBe('prompt');
    if (page.kind === 'prompt') expect(page.prompt).toContain('[y/N]');
  });

  it('does not mistake the board list legend for an input prompt', () => {
    const page = fixture('06-after-b');
    expect(page.kind).toBe('boardList');
  });

  it('parses the post list with postno/date/author/title and cursor', () => {
    const page = fixture('10-after-pagedown');
    expect(page.kind).toBe('postList');
    if (page.kind !== 'postList') return;
    expect(page.board).toBe('Chat');
    expect(page.items.length).toBeGreaterThanOrEqual(9);
    const sel = page.items[page.selectedIndex];
    expect(sel.selected).toBe(true);
    expect(sel.postno).toBe('66229');
    expect(sel.author).toBe('h81814');
    const marked = page.items.find((p) => p.postno === '66221');
    expect(marked?.mark).toBe('+');
    expect(marked?.date).toBe('09/14');
    expect(page.legend.some((l) => l.label.includes('閱讀'))).toBe(true);
  });

  it('parses the article view with metadata and body', () => {
    const page = fixture('09-after-open-post');
    expect(page.kind).toBe('article');
    if (page.kind !== 'article') return;
    expect(page.meta.board).toBe('Chat');
    expect(page.meta.author).toContain('h81814');
    expect(page.meta.title).toContain('職場');
    expect(page.body.join('\n')).toContain('經濟');
  });

  it('parses a scrolled post list that uses old-style mYYMM/DD dates', () => {
    const rows = [
      '【板主：NidhoggAC/SMB174】         講談說論 (文章保留七天)        看板《Chat》',
      '[←]離開 [→]閱讀 [^P]發表 [b]進板公告 [V]投票 [TAB]精華區 [g]推薦 [h]說明',
      '  編號    日 期 作  者       文  章  標  題',
      '     1 m9901/21 sega         ◇ [道歉] Chat板砍板事件',
      '     2 m9906/04 rezo         ◇ [惡搞]超級機器人大戰HK',
      '>    3 m9906/13 zerow        ◇ [問題] 測試文章',
    ];
    const page = parseScreen({ rows });
    expect(page.kind).toBe('postList');
    if (page.kind !== 'postList') return;
    expect(page.items).toHaveLength(3);
    expect(page.items[0].postno).toBe('1');
    expect(page.items[0].date).toBe('m9901/21');
    expect(page.items[0].author).toBe('sega');
    expect(page.items[1].author).toBe('rezo');
    expect(page.selectedIndex).toBe(2);
  });

  it('does not throw on the board splash screen', () => {
    const page = fixture('08-after-chat-enter');
    expect(['text', 'notice', 'unknown']).toContain(page.kind);
  });
});
