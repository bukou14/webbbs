// @vitest-environment jsdom
/// <reference types="node" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { parseScreen, type BbsPage } from '../../utils/bbsScreen';
import type { BbsActions, BbsBrowserShellProps } from './types';
import { BbsBrowserShell } from './BbsBrowserShell';

afterEach(() => cleanup());

function fixture(name: string): BbsPage {
  const path = resolve(process.cwd(), 'src/utils/__fixtures__', `${name}.txt`);
  const rows = readFileSync(path, 'utf8').split('\n');
  return parseScreen({ rows });
}

function makeActions(): BbsActions {
  return {
    select: vi.fn(),
    open: vi.fn(),
    up: vi.fn(),
    down: vi.fn(),
    left: vi.fn(),
    right: vi.fn(),
    enter: vi.fn(),
    pageUp: vi.fn(),
    pageDown: vi.fn(),
    home: vi.fn(),
    end: vi.fn(),
    back: vi.fn(),
    quit: vi.fn(),
    startSearch: vi.fn(),
    submitSearch: vi.fn(),
    cancelSearch: vi.fn(),
    threadFirst: vi.fn(),
    threadPrev: vi.fn(),
    threadNext: vi.fn(),
    readThread: vi.fn(),
    openComposer: vi.fn(),
    submitLogin: vi.fn(),
    submitPrompt: vi.fn(),
    raw: vi.fn(),
  };
}

function renderShell(page: BbsPage | null) {
  const actions = makeActions();
  const props: BbsBrowserShellProps = {
    page,
    status: 'connected',
    statusText: '已連線',
    actions,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
  };
  render(<BbsBrowserShell {...props} />);
  return { actions };
}

describe('BbsBrowserShell render smoke test', () => {
  it('shows the connecting state when no page is available', () => {
    renderShell(null);
    expect(screen.getByText(/Connecting to 巴哈姆特 BBS/)).toBeTruthy();
  });

  it('renders the parsed main-menu fixture', () => {
    const page = fixture('05-main-menu');
    expect(page.kind).toBe('menu');
    renderShell(page);

    expect(screen.getByText('精華公佈欄')).toBeTruthy();
    expect(screen.getByText('告別巴哈姆特')).toBeTruthy();
    const selected = document.querySelector('.bbs-menu-item.bbs-selected');
    expect(selected?.textContent).toContain('佈告討論區');
  });

  it('renders the parsed board-list fixture', () => {
    const page = fixture('06-after-b');
    expect(page.kind).toBe('boardList');
    renderShell(page);

    expect(screen.getAllByText('Abuse').length).toBeGreaterThan(0);
    expect(screen.getByText('巴哈姆特檢舉反映中心')).toBeTruthy();
    expect(screen.getAllByText(/尚未選定/).length).toBeGreaterThan(0);
  });

  it('renders the parsed post-list fixture', () => {
    const page = fixture('10-after-pagedown');
    expect(page.kind).toBe('postList');
    renderShell(page);

    expect(screen.getByText('66229')).toBeTruthy();
    expect(screen.getByText('h81814')).toBeTruthy();
    expect(screen.getAllByText(/Chat/).length).toBeGreaterThan(0);
  });

  it('renders the parsed article fixture', () => {
    const page = fixture('09-after-open-post');
    expect(page.kind).toBe('article');
    renderShell(page);

    expect(screen.getByRole('heading', { name: /職場/ })).toBeTruthy();
    expect(screen.getByText('第 1 頁')).toBeTruthy();
    expect(document.querySelector('.bbs-article-quote')).toBeTruthy();
  });
});
