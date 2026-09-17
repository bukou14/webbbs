/**
 * Structured parser for Bahamut BBS terminal screens.
 *
 * Input is the rendered 80x24 screen as plain text rows (from an xterm buffer),
 * optionally with per-row dominant background color (used as a selection hint
 * when a BBS variant does not print a leading '>' marker).
 *
 * Output is a discriminated union describing the *page* the user is looking at,
 * with enough structure for native HTML rendering.
 */

export type RowColor = {
  bgMode: number;
  bg: number;
  fg?: number;
  bgCount: number;
  cells: number;
};

export type ScreenGrid = {
  rows: string[];
  colors?: RowColor[];
};

export type BbsPageHeader = {
  /** Text inside the leading 【 ... 】, e.g. "主功能表" or "板主：..." */
  title: string;
  /** Right-hand board name inside 看板《 ... 》, if present. */
  board?: string;
  /** Middle free text, e.g. board tagline. */
  subtitle?: string;
  /** Site name (e.g. 巴哈姆特) when it sits between the title and board. */
  site?: string;
};

export type LegendItem = {
  key: string;
  label: string;
};

export type MenuItem = {
  key: string;
  label: string;
  selected: boolean;
};

export type BoardItem = {
  index: number;
  name: string;
  status: string;
  description: string;
  moderator: string;
  selected: boolean;
};

export type PostItem = {
  index: number;
  postno: string;
  mark: string;
  date: string;
  author: string;
  title: string;
  selected: boolean;
};

export type ArticleMeta = {
  author: string;
  board: string;
  title: string;
  date: string;
};

export type BbsPage =
  | { kind: 'connecting'; lines: string[] }
  | { kind: 'ko'; lines: string[] }
  | { kind: 'login'; field: 'username' | 'password'; prompt: string }
  | { kind: 'notice'; lines: string[]; title?: string }
  | { kind: 'menu'; header: BbsPageHeader; items: MenuItem[]; selectedIndex: number; footer: string[] }
  | { kind: 'boardList'; header: BbsPageHeader; items: BoardItem[]; selectedIndex: number; legend: LegendItem[]; prompt?: string }
  | { kind: 'postList'; header: BbsPageHeader; board: string; items: PostItem[]; selectedIndex: number; legend: LegendItem[]; page: number; prompt?: string }
  | { kind: 'article'; header: BbsPageHeader; meta: ArticleMeta; body: string[]; legend: LegendItem[]; page: number }
  | { kind: 'text'; header: BbsPageHeader; lines: string[]; legend: LegendItem[] }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'unknown'; lines: string[] };

const isBlank = (s: string) => s.trim().length === 0;

/** True when the row carries the cursor marker (leading '>' anywhere in indent). */
const hasSel = (line: string) => /^\s*>/.test(line);

const stripSel = (line: string) => line.replace(/^\s*>\s?/, '');

/** Extract `[key]label` legend pairs from a chrome line. */
export function parseLegend(line: string): LegendItem[] {
  const items: LegendItem[] = [];
  for (const m of line.matchAll(/\[([^\]]+)\]\s*([^[]*)/g)) {
    const key = m[1].trim();
    const label = m[2].trim();
    if (key) items.push({ key, label });
  }
  return items;
}

/** Parse the top status/header line. */
export function parseHeader(line: string): BbsPageHeader {
  const header: BbsPageHeader = { title: '' };
  const title = line.match(/【([^】]*)】/);
  if (title) header.title = title[1].trim();
  const board = line.match(/看板《([^》]*)》/);
  if (board) header.board = board[1].trim();

  // Free text between the 【】 block and 看板《》 (or end of line).
  const after = title ? line.slice(line.indexOf('】') + 1) : line;
  let middle = after;
  const boardIdx = middle.indexOf('看板《');
  if (boardIdx >= 0) middle = middle.slice(0, boardIdx);
  middle = middle.replace(/\s{2,}/g, ' ').trim();
  if (middle) header.subtitle = middle;
  return header;
}

type Candidate = { index: number; line: string };

function pickSelected(candidates: Candidate[], colors?: RowColor[]): number {
  for (let i = 0; i < candidates.length; i++) {
    if (hasSel(candidates[i].line)) return i;
  }
  // Fallback: a clearly highlighted row (own background, enough cells).
  if (colors) {
    for (let i = 0; i < candidates.length; i++) {
      const col = colors[candidates[i].index];
      if (col && col.bgMode !== 0 && col.bgCount > 4) return i;
    }
  }
  return candidates.length ? 0 : -1;
}

function parseMenuRows(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  lines.forEach((line, index) => {
    if (/^\s*>?\s*\([A-Za-z]\)\w+\s+/.test(line)) out.push({ index, line });
  });
  return out;
}

export function parseMenu(lines: string[]): MenuItem[] {
  const items: MenuItem[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(>?)\s*\(([A-Za-z])\)\w*\s+(?:【\s*(.+?)\s*】|(\S.*?))\s*$/);
    if (!m) continue;
    items.push({ key: m[2].toUpperCase(), label: (m[3] || m[4] || '').trim(), selected: false });
  }
  return items;
}

export function parseBoardRows(lines: string[]): BoardItem[] {
  const items: BoardItem[] = [];
  for (const line of lines) {
    const clean = stripSel(line);
    if (!/^\s*\d+\s+\S/.test(clean)) continue;
    const m = clean.match(/^\s*(\d+)\s+(\S+)\s+([◎◇○□▽△☆※★])\s+(.*)$/);
    if (!m) continue;
    const rest = m[4].replace(/\s+$/, '');
    const parts = rest.split(/\s{2,}/);
    items.push({
      index: Number(m[1]),
      name: m[2],
      status: m[3],
      description: (parts[0] || '').trim(),
      moderator: (parts.slice(1).join(' ') || '').trim(),
      selected: false,
    });
  }
  return items;
}

export function parsePostRows(lines: string[]): PostItem[] {
  const items: PostItem[] = [];
  for (const line of lines) {
    const clean = stripSel(line);
    if (!/^\s*\d{1,6}\s+\S/.test(clean)) continue;
    const m = clean.match(/^\s*(\d{1,6})\s+(.*)$/);
    if (!m) continue;
    const rest = m[2];
    const d = rest.match(
      /^([+◇○□▽△☆※~M=sS!]?)\s*(m\d{4}\/\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)\s+(\S+)\s+(.*)$/,
    );
    if (!d) continue;
    items.push({
      index: Number(m[1]),
      postno: m[1],
      mark: d[1] || '',
      date: d[2],
      author: d[3],
      title: d[4].trim(),
      selected: false,
    });
  }
  return items;
}

export function parseArticle(lines: string[]): { meta: ArticleMeta; body: string[] } | null {
  const authorIdx = lines.findIndex((l) => /^作者[:：]/.test(l));
  const titleIdx = lines.findIndex((l) => /^標題[:：]/.test(l));
  const timeIdx = lines.findIndex((l) => /^時間[:：]/.test(l));
  if (authorIdx < 0 || titleIdx < 0 || timeIdx < 0) return null;

  const authorLine = lines[authorIdx].replace(/^作者[:：]\s*/, '');
  const boardM = authorLine.match(/看板[:：]\s*(\S+)/);
  const meta: ArticleMeta = {
    author: authorLine.replace(/\s*看板[:：].*$/, '').trim(),
    board: boardM ? boardM[1] : '',
    title: lines[titleIdx].replace(/^標題[:：]\s*/, '').trim(),
    date: lines[timeIdx].replace(/^時間[:：]\s*/, '').trim(),
  };

  const end = lines.findIndex((l, i) => i > timeIdx && /(文章選讀|瀏覽\s*第|\s\(g\)[^\n]*離開閱讀)/.test(l));
  const body = lines.slice(timeIdx + 1, end >= 0 ? end : lines.length);
  while (body.length && isBlank(body[0])) body.shift();
  while (body.length && isBlank(body[body.length - 1])) body.pop();
  return { meta, body };
}

function firstMeaningful(lines: string[]): string {
  return lines.find((l) => l.trim()) || '';
}

/** A chrome line that is waiting for the user to type a value (e.g. 搜尋標題：, 請輸入關鍵字：, 限定有m標記的文章? [y/N]：). */
export function findInputPrompt(lines: string[]): string | undefined {
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.length > 60) continue;
    const prefixed = /^(請輸入|輸入|搜尋)/.test(t);
    const searchish = /(請輸入|搜尋|關鍵字)/.test(t) && /[:：]\s*$/.test(t);
    const choice = /[[(（]\s*[yYnNＹＮ]\s*[/／]\s*[yYnNＹＮ]\s*[\])）]/.test(t);
    if (prefixed || searchish || choice) return t;
  }
  return undefined;
}

export function parseScreen(grid: ScreenGrid): BbsPage {
  const rows = grid.rows ?? [];
  const lines = rows.map((r) => (r ?? '').replace(/\s+$/, ''));
  const nonBlank = lines.filter((l) => !isBlank(l));
  const all = lines.join('\n');

  if (!nonBlank.length) return { kind: 'connecting', lines };

  // Login takes priority: the K.O. attract screen prints the username prompt too.
  if (lines.some((l) => l.includes('請輸入勇者密碼') || l.includes('輸入密碼'))) {
    return { kind: 'login', field: 'password', prompt: '請輸入勇者密碼' };
  }
  if (lines.some((l) => l.includes('請輸入勇者代號') || l.includes('輸入代號'))) {
    return { kind: 'login', field: 'username', prompt: '請輸入勇者代號' };
  }

  if (/Champion|\[ＫＯ\]|バハムート/.test(all) && /Champion|ＫＯ/.test(all)) {
    return { kind: 'ko', lines };
  }

  const header = parseHeader(lines[0] || '');
  const legendLine = lines.find((l) => l.includes('[') && l.includes(']') && !l.startsWith('[9/'));
  const legend = legendLine ? parseLegend(legendLine) : [];

  // Main menu.
  const menuRows = parseMenuRows(lines);
  const menuItems = parseMenu(lines);
  if (/主功能表/.test(lines[0] || '') && menuItems.length >= 3) {
    const selectedIndex = pickSelected(menuRows, grid.colors);
    menuItems.forEach((it, i) => (it.selected = i === selectedIndex));
    const footer = nonBlank.filter((l) => l.startsWith('[9/'));
    return { kind: 'menu', header, items: menuItems, selectedIndex, footer };
  }

  // Article view (has 作者:/標題:/時間: block).
  const article = !/看板列表/.test(all) ? parseArticle(lines) : null;
  if (article) {
    const pageM = all.match(/瀏覽\s*第\s*(\d+)\s*\/\s*(\d+)\s*頁/);
    return {
      kind: 'article',
      header,
      meta: article.meta,
      body: article.body,
      legend,
      page: pageM ? Number(pageM[1]) : 1,
    };
  }

  // Board list.
  const isBoardList = /看板列表/.test(all) || (/編號/.test(all) && /看\s*板/.test(all) && /看板《/.test(all));
  const boardItems = isBoardList ? parseBoardRows(lines) : [];
  if (isBoardList && boardItems.length >= 1) {
    const rowsC: Candidate[] = [];
    lines.forEach((line, index) => {
      if (/^\s*>?\s*\d+\s+\S+\s+[◎◇○□▽△☆※★]/.test(line)) rowsC.push({ index, line });
    });
    const selectedIndex = pickSelected(rowsC, grid.colors);
    boardItems.forEach((it, i) => (it.selected = i === selectedIndex));
    const prompt = lines.find((l) => l.includes('請輸入看板名稱') || l.includes('輸入看板名稱'));
    return { kind: 'boardList', header, items: boardItems, selectedIndex, legend, prompt };
  }

  // Post list.
  const postItems = parsePostRows(lines);
  const isPostList = /看板《/.test(lines[0] || '') && postItems.length >= 1;
  if (isPostList) {
    const rowsC: Candidate[] = [];
    lines.forEach((line, index) => {
      if (/^\s*>?\s*\d{1,6}\s/.test(line)) rowsC.push({ index, line });
    });
    const selectedIndex = pickSelected(rowsC, grid.colors);
    postItems.forEach((it, i) => (it.selected = i === selectedIndex));
    const pageM = all.match(/(\d+)\/(\d+)\s*頁/) || all.match(/第\s*(\d+)\s*頁/);
    const prompt = findInputPrompt(lines);
    return {
      kind: 'postList',
      header,
      board: header.board || '',
      items: postItems,
      selectedIndex,
      legend,
      page: pageM ? Number(pageM[1]) : 1,
      prompt,
    };
  }

  const prompt = findInputPrompt(lines);
  if (prompt) return { kind: 'prompt', prompt };

  // System notice / announcement screens.
  const titleLine = firstMeaningful(lines);
  const isNotice =
    /系統公告|過\s*路\s*勇\s*者|請按任意鍵|任意鍵|按 Enter/.test(all) ||
    /^[□■]/.test(titleLine) ||
    /^【\s*[^】]*\s*】$/.test(titleLine.trim());
  if (isNotice) {
    const tm = titleLine.match(/【\s*(.+?)\s*】/);
    const title = tm
      ? tm[1].trim()
      : titleLine.replace(/[□■※]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return { kind: 'notice', title: title || undefined, lines };
  }

  return { kind: 'text', header, lines, legend };
}

export const parseBbsScreen = parseScreen;
