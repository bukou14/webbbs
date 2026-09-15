import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { createBig5Decoder, encodeText } from '../utils/encoding';
import { parseScreen, type BbsPage, type RowColor } from '../utils/bbsScreen';
import { KEY } from '../utils/bbsKeys';
import type {
  BbsActions,
  ComposerState,
  ConnectionStatus,
  ReplyDraft,
  ThreadArticle,
  ThreadReaderState,
} from '../components/bbs/types';

const COLS = 80;
const ROWS = 24;
const QUIET_MS = 140;
const MAX_WAIT_MS = 700;
const STEP_MS = 70;
const THREAD_STEP_MS = 1800;
const THREAD_MAX = 120;

type Step = [sequence: string | null, delayMs?: number];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hashPage(page: BbsPage): string {
  const json = JSON.stringify(page);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function selectedIndexOf(page: BbsPage | null): number {
  if (!page) return -1;
  if (page.kind === 'menu' || page.kind === 'boardList' || page.kind === 'postList') {
    return page.selectedIndex;
  }
  return -1;
}

function articleKey(page: Extract<BbsPage, { kind: 'article' }>): string {
  const body = page.body.join('\n');
  return `${page.meta.author}|${page.meta.title}|${body.length}|${body.slice(0, 40)}`;
}

function deriveBreadcrumbs(page: BbsPage | null): string[] {
  if (!page) return [];
  switch (page.kind) {
    case 'menu':
      return ['主功能表'];
    case 'boardList':
      return ['首頁', '看板列表'];
    case 'postList':
      return ['首頁', page.board ? `看板《${page.board}》` : '看板'];
    case 'article':
      return ['首頁', page.meta.board ? `看板《${page.meta.board}》` : '看板', page.meta.title];
    default:
      return [];
  }
}

export function useBbsSession() {
  const termRef = useRef<Terminal | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<((bytes: Uint8Array) => string) | null>(null);
  const pageRef = useRef<BbsPage | null>(null);
  const hashRef = useRef('');
  const dirtyRef = useRef(false);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const collectRef = useRef<{
    active: boolean;
    lastKey: string;
    count: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const captureStepRef = useRef<(() => void) | null>(null);
  const credsRef = useRef<{ username: string; password: string } | null>(null);
  const userClosedRef = useRef(false);
  const autoLoginRef = useRef(false);
  const lastBoardRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [page, setPage] = useState<BbsPage | null>(null);
  const [rawText, setRawText] = useState('');
  const [threadReader, setThreadReader] = useState<ThreadReaderState | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const getTerm = useCallback((): Terminal => {
    if (!termRef.current) {
      const container = document.createElement('div');
      container.setAttribute('aria-hidden', 'true');
      container.style.cssText =
        'position:absolute;left:-10000px;top:0;width:640px;height:384px;overflow:hidden;';
      document.body.appendChild(container);
      containerRef.current = container;
      const term = new Terminal({
        cols: COLS,
        rows: ROWS,
        scrollback: 0,
        convertEol: false,
        allowProposedApi: true,
      });
      term.open(container);
      termRef.current = term;
    }
    return termRef.current;
  }, []);

  const readScreen = useCallback((): { rows: string[]; colors: RowColor[] } => {
    const term = termRef.current;
    const rows: string[] = [];
    const colors: RowColor[] = [];
    for (let i = 0; i < ROWS; i++) {
      const line = term?.buffer.active.getLine(i);
      rows.push(line ? line.translateToString(true) : '');
      if (!line) {
        colors.push({ bgMode: 0, bg: 0, bgCount: 0, cells: 0 });
        continue;
      }
      const counts = new Map<string, number>();
      let cells = 0;
      for (let x = 0; x < COLS; x++) {
        const cell = line.getCell(x);
        if (!cell) continue;
        cells++;
        const ch = cell.getChars();
        if (!ch || ch === ' ') continue;
        const key = `${cell.getBgColorMode()}:${cell.getBgColor()}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let best = '0:0';
      let bestCount = 0;
      for (const [key, count] of counts) {
        if (count > bestCount) { bestCount = count; best = key; }
      }
      const [bgMode, bg] = best.split(':').map(Number);
      colors.push({ bgMode, bg, bgCount: bestCount, cells });
    }
    return { rows, colors };
  }, []);

  const publish = useCallback(() => {
    const { rows, colors } = readScreen();
    const next = parseScreen({ rows, colors });
    setRawText(rows.join('\n'));
    const hash = hashPage(next);
    if (hash === hashRef.current) return;
    hashRef.current = hash;
    pageRef.current = next;
    setPage(next);
  }, [readScreen]);

  const settle = useCallback(() => {
    if (quietTimer.current) { clearTimeout(quietTimer.current); quietTimer.current = null; }
    if (hardTimer.current) { clearTimeout(hardTimer.current); hardTimer.current = null; }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    publish();
  }, [publish]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(settle, QUIET_MS);
    if (!hardTimer.current) hardTimer.current = setTimeout(settle, MAX_WAIT_MS);
  }, [settle]);

  const send = useCallback((sequence: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const encoded = encodeText(sequence);
    const framed = new Uint8Array(encoded.byteLength);
    framed.set(encoded);
    ws.send(framed);
  }, []);

  const enqueue = useCallback((steps: Step[]) => {
    queueRef.current = queueRef.current.then(async () => {
      for (const [sequence, delay = STEP_MS] of steps) {
        if (sequence !== null) send(sequence);
        if (delay > 0) await sleep(delay);
      }
    });
  }, [send]);

  const closeSocket = useCallback(() => {
    if (quietTimer.current) { clearTimeout(quietTimer.current); quietTimer.current = null; }
    if (hardTimer.current) { clearTimeout(hardTimer.current); hardTimer.current = null; }
    if (collectRef.current?.timer) clearTimeout(collectRef.current.timer);
    collectRef.current = null;
    setThreadReader(null);
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch { /* already closing */ }
      wsRef.current = null;
    }
  }, []);

  const openSocket = useCallback((auto: boolean) => {
    closeSocket();
    setError(null);
    setStatus(auto ? 'reconnecting' : 'connecting');
    autoLoginRef.current = auto && credsRef.current !== null;
    decoderRef.current = createBig5Decoder();
    const term = getTerm();
    term.reset();

    const ws = new WebSocket(`ws://${window.location.hostname}:8080`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => setStatus('connected');
    ws.onclose = () => {
      wsRef.current = null;
      if (!userClosedRef.current && credsRef.current) {
        setStatus('reconnecting');
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => openSocket(true), 3000);
      } else {
        setStatus('disconnected');
      }
    };
    ws.onerror = () => setError('無法連線到 BBS (WebSocket error)');
    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const decoded = decoderRef.current?.(new Uint8Array(event.data)) ?? '';
      term.write(decoded, () => markDirty());
    };

    wsRef.current = ws;
  }, [closeSocket, getTerm, markDirty]);

  const disconnect = useCallback(() => {
    userClosedRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    closeSocket();
    setStatus('disconnected');
  }, [closeSocket]);

  const connect = useCallback(() => {
    userClosedRef.current = false;
    openSocket(false);
  }, [openSocket]);

  const moveTo = useCallback((target: number) => {
    const current = selectedIndexOf(pageRef.current);
    const from = current >= 0 ? current : 0;
    if (target === from) return;
    const key = target > from ? KEY.down : KEY.up;
    const steps: Step[] = Array.from(
      { length: Math.min(Math.abs(target - from), 25) },
      () => [key, STEP_MS] as Step,
    );
    enqueue(steps);
  }, [enqueue]);

  const performOpen = useCallback((index: number) => {
    const p = pageRef.current;
    if (!p || (p.kind !== 'menu' && p.kind !== 'boardList' && p.kind !== 'postList')) return;
    if (p.kind === 'menu') {
      const item = p.items[index];
      if (item) enqueue([[item.key + KEY.enter, 0]]);
      return;
    }
    if (p.kind === 'boardList' || p.kind === 'postList') {
      moveTo(index);
      enqueue([[null, 220], [KEY.right, 0]]);
    }
  }, [enqueue, moveTo]);

  const finishThreadCollect = useCallback(() => {
    const c = collectRef.current;
    if (c?.timer) clearTimeout(c.timer);
    collectRef.current = null;
    setThreadReader((prev) => (prev ? { ...prev, status: 'done' } : prev));
  }, []);

  const captureStep = useCallback(() => {
    const c = collectRef.current;
    if (!c?.active) return;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; }
    const current = pageRef.current;
    if (current?.kind !== 'article') {
      finishThreadCollect();
      return;
    }
    const key = articleKey(current);
    if (key === c.lastKey || c.count >= THREAD_MAX) {
      finishThreadCollect();
      return;
    }
    c.lastKey = key;
    c.count += 1;
    const snapshot: ThreadArticle = {
      title: current.meta.title,
      author: current.meta.author,
      board: current.meta.board,
      date: current.meta.date,
      body: current.body,
    };
    setThreadReader((prev) => (prev ? { ...prev, articles: [...prev.articles, snapshot] } : prev));
    send('+');
    c.timer = setTimeout(() => captureStepRef.current?.(), THREAD_STEP_MS);
  }, [finishThreadCollect, send]);
  captureStepRef.current = captureStep;

  const closeThreadReader = useCallback(() => {
    const c = collectRef.current;
    if (c?.timer) clearTimeout(c.timer);
    collectRef.current = null;
    setThreadReader(null);
  }, []);

  const readThread = useCallback(() => {
    const current = pageRef.current;
    if (current?.kind !== 'article') return;
    const existing = collectRef.current;
    if (existing?.timer) clearTimeout(existing.timer);
    collectRef.current = { active: true, lastKey: '', count: 0, timer: null };
    setThreadReader({
      board: current.meta.board,
      title: current.meta.title,
      articles: [],
      status: 'collecting',
    });
    send('=');
    collectRef.current.timer = setTimeout(() => captureStepRef.current?.(), THREAD_STEP_MS);
  }, [send]);

  const waitForScreen = useCallback(
    async (pattern: RegExp, timeout = 8000): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (pattern.test(readScreen().rows.join('\n'))) return true;
        await sleep(200);
      }
      return false;
    },
    [readScreen],
  );

  const submitLogin = useCallback(
    (field: 'username' | 'password', value: string) => {
      if (!value) return;
      const prev = credsRef.current;
      credsRef.current =
        field === 'username'
          ? { username: value, password: prev?.password ?? '' }
          : { username: prev?.username ?? '', password: value };
      send(value + '\r');
    },
    [send],
  );

  const restoreBoard = useCallback(
    async (board: string) => {
      send('b\r');
      await sleep(1500);
      if (await waitForScreen(/看板列表|請輸入看板名稱/, 8000)) {
        send('s');
        await sleep(1000);
        send(board + '\r');
        await sleep(2500);
      }
    },
    [send, waitForScreen],
  );

  const openComposer = useCallback(() => {
    const current = pageRef.current;
    if (current?.kind !== 'article') return;
    const base = current.meta.title.replace(/^\s*(Re|Fw|轉)\s*[:：]?\s*/i, '').trim();
    setComposer({ board: current.meta.board, title: `Re: ${base}`, status: 'editing' });
  }, []);

  const closeComposer = useCallback(() => {
    const text = readScreen().rows.join('\n');
    if (/編輯文章|檔案處理|\[S\]存檔/.test(text)) {
      send('\x18');
      setTimeout(() => send('a'), 700);
    }
    setComposer(null);
  }, [readScreen, send]);

  const submitReply = useCallback(
    async (draft: ReplyDraft) => {
      const fail = (message: string) =>
        setComposer((prev) => (prev ? { ...prev, status: 'error', message } : prev));
      setComposer((prev) => (prev ? { ...prev, status: 'sending', message: '開啟回覆…' } : prev));
      try {
        send('y');
        if (!(await waitForScreen(/回應至|\(F\)看板/)))
          throw new Error('未出現「回應至」選項，回覆取消');
        send(draft.destination + '\r');
        await sleep(800);
        if (!(await waitForScreen(/類別[:：]/))) throw new Error('未出現「類別」選項，回覆取消');
        send(draft.category + '\r');
        await sleep(800);
        if (!(await waitForScreen(/標題[:：]/))) throw new Error('未出現「標題」欄位，回覆取消');
        send(draft.title + '\r');
        await sleep(800);
        if (await waitForScreen(/引用原文/, 4000)) {
          send(draft.quote === 'Y' ? '\r' : draft.quote + '\r');
          await sleep(800);
        }
        if (await waitForScreen(/簽名檔/, 4000)) {
          send(draft.signature === '0' ? '\r' : draft.signature + '\r');
          await sleep(800);
        }
        if (!(await waitForScreen(/編輯文章|檔案處理/, 10000)))
          throw new Error('未進入文章編輯器，回覆取消');

        setComposer((prev) => (prev ? { ...prev, message: '輸入內容中…' } : prev));
        for (const line of draft.body.replace(/\r\n/g, '\n').split('\n')) {
          send(line + '\r');
          await sleep(90);
        }
        await sleep(400);

        setComposer((prev) => (prev ? { ...prev, message: '存檔中…' } : prev));
        send('\x18');
        if (!(await waitForScreen(/\[S\]存檔|\(A\)放棄/)))
          throw new Error('未出現存檔選單，回覆未送出');
        await sleep(400);
        send('s');
        await sleep(1500);
        setComposer((prev) =>
          prev ? { ...prev, status: 'done', message: '已張貼回覆（BBS 存檔完成）' } : prev,
        );
      } catch (e) {
        fail(e instanceof Error ? e.message : '回覆失敗');
      }
    },
    [send, waitForScreen],
  );

  const actions = useMemo<BbsActions>(() => ({
    select: moveTo,
    open: performOpen,
    up: () => send(KEY.up),
    down: () => send(KEY.down),
    left: () => send(KEY.left),
    right: () => send(KEY.right),
    enter: () => send(KEY.enter),
    pageUp: () => send(KEY.pageUp),
    pageDown: () => send(KEY.pageDown),
    home: () => send(KEY.home),
    end: () => send(KEY.end),
    back() {
      const p = pageRef.current;
      if (p?.kind === 'boardList') send(KEY.left);
      else if (p?.kind === 'article') enqueue([['q', 250], ['e', 250], [KEY.left, 200]]);
      else send('q');
    },
    quit: () => send('q'),
    startSearch() {
      send('s');
    },
    threadFirst: () => send('='),
    threadPrev: () => send('-'),
    threadNext: () => send('+'),
    readThread,
    openComposer,
    submitLogin,
    submitSearch(query: string) {
      enqueue([[query, 120], [KEY.enter, 80]]);
    },
    cancelSearch: () => send('\x1b'),
    raw: (sequence: string) => send(sequence),
  }), [send, enqueue, moveTo, performOpen, readThread, openComposer, submitLogin]);

  useEffect(() => {
    if (page?.kind === 'postList') lastBoardRef.current = page.board || null;
    else if (page?.kind === 'article') lastBoardRef.current = page.meta.board || null;
  }, [page]);

  // Bahamut allows one session per account; a second login triggers this prompt,
  // and leaving it unanswered drops the connection. Always answer Y.
  useEffect(() => {
    if (!page) return;
    const text = page.kind === 'notice' || page.kind === 'text'
      ? page.lines.join('\n')
      : '';
    if (/重複.*(登入|login)/i.test(text)) {
      send('Y\r');
    }
  }, [page, send]);

  useEffect(() => {
    if (!autoLoginRef.current) return;
    const creds = credsRef.current;
    if (!page || !creds) return;
    if (page.kind === 'login') {
      send((page.field === 'password' ? creds.password : creds.username) + '\r');
    } else if (page.kind === 'notice' && /任意鍵/.test(page.lines.join(''))) {
      send('\r');
    } else if (page.kind === 'menu') {
      autoLoginRef.current = false;
      const board = lastBoardRef.current;
      if (board) void restoreBoard(board);
    }
  }, [page, send, restoreBoard]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      containerRef.current?.remove();
      containerRef.current = null;
    };
  }, [disconnect]);

  const breadcrumbs = useMemo(() => deriveBreadcrumbs(page), [page]);
  const statusText = useMemo(() => {
    if (status === 'connecting') return '連線中…';
    if (status === 'reconnecting') return '重新連線中…';
    if (status === 'disconnected') return '未連線';
    if (page?.kind === 'postList') return page.board ? `看板《${page.board}》` : '文章列表';
    if (page?.kind === 'boardList') return `看板 ${page.items.length} 個`;
    switch (page?.kind) {
      case 'article': return '文章';
      case 'menu': return '主功能表';
      case 'login': return '登入';
      case 'notice': return '公告';
      case 'text': return '內容';
      default: return '';
    }
  }, [status, page]);

  return {
    page,
    rawText,
    status,
    statusText,
    error,
    busy: status === 'connecting',
    breadcrumbs,
    threadReader,
    composer,
    actions,
    connect,
    disconnect,
    closeThreadReader,
    closeComposer,
    submitReply,
  };
}
