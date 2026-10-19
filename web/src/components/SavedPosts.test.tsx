// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SavedPostsPage } from './SavedPostsPage';

function post(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    postno: `bbs_chat_${1000 + id}`,
    title: 'Re: 主題A',
    author: `author${id}`,
    date: `date${id}`,
    first_posted_at: null,
    subject: '主題A',
    mark: null,
    content: `body ${id} 第一行\n> 引述行`,
    created_at: null,
    ...overrides,
  };
}

/** Minimal Response stand-in: the hook only reads `ok` and `json()`. */
const json = (data: unknown) => ({ ok: true, json: async () => data }) as unknown as Response;

function stubFetch(threadPosts: ReturnType<typeof post>[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/thread')) return json({ subject: '主題A', posts: threadPosts });
    if (url.startsWith('/api/posts?')) {
      return json({ posts: threadPosts, total: threadPosts.length, page: 1, limit: 20 });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SavedPostsPage', () => {
  it('lists saved posts with the BBS 文章列表 columns', async () => {
    stubFetch([post(1, { mark: 'm' })]);
    render(<SavedPostsPage />);

    const table = await screen.findByRole('table');
    for (const label of ['#', '編號', '標記', '日期', '作者', '標題']) {
      expect(within(table).getByText(label)).toBeTruthy();
    }
    // 編號 shows the BBS article number, not the internal postno.
    expect(within(table).getByText('1001')).toBeTruthy();
    expect(within(table).getByText('m')).toBeTruthy();
    // `Re: ` prefix is kept in the list, while the reader reports the 同主題 subject.
    expect(within(table).getByText('Re: 主題A')).toBeTruthy();
  });

  it('opens the article and walks the 同主題 thread', async () => {
    stubFetch([post(1), post(2), post(3)]);
    render(<SavedPostsPage />);

    const [firstRead] = await screen.findAllByRole('button', { name: '閱讀' });
    fireEvent.click(firstRead);

    const reader = await screen.findByRole('dialog', { name: '文章內容' });
    expect(within(reader).getByRole('heading', { name: 'Re: 主題A' })).toBeTruthy();
    await waitFor(() => expect(within(reader).getByText('第 1 / 3 篇')).toBeTruthy());

    const next = within(reader).getByRole('button', { name: /下一篇/ });
    fireEvent.click(next);
    await waitFor(() => expect(within(reader).getByText('第 2 / 3 篇')).toBeTruthy());

    fireEvent.click(within(reader).getByRole('button', { name: /上一篇/ }));
    await waitFor(() => expect(within(reader).getByText('第 1 / 3 篇')).toBeTruthy());
    expect(within(reader).getByRole('button', { name: /上一篇/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('reads the whole thread through 串接閱讀全部', async () => {
    stubFetch([post(1), post(2), post(3)]);
    render(<SavedPostsPage />);

    const [firstRead] = await screen.findAllByRole('button', { name: '閱讀' });
    fireEvent.click(firstRead);
    const reader = await screen.findByRole('dialog', { name: '文章內容' });
    await waitFor(() => expect(within(reader).getByText('第 1 / 3 篇')).toBeTruthy());

    fireEvent.click(within(reader).getByRole('button', { name: /串接閱讀全部/ }));

    const thread = await screen.findByRole('dialog', { name: '串接閱讀' });
    expect(within(thread).getByText('看板《Chat》 · 共 3 篇 · 完成')).toBeTruthy();
    expect(thread.querySelectorAll('.bbs-thread-post')).toHaveLength(3);

    fireEvent.click(within(thread).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '串接閱讀' })).toBeNull());
    expect(await screen.findByRole('dialog', { name: '文章內容' })).toBeTruthy();
  });

  it('disables thread navigation when the subject has a single post', async () => {
    stubFetch([post(7)]);
    render(<SavedPostsPage />);

    const [firstRead] = await screen.findAllByRole('button', { name: '閱讀' });
    fireEvent.click(firstRead);
    const reader = await screen.findByRole('dialog', { name: '文章內容' });
    await waitFor(() => expect(within(reader).getByText('第 1 / 1 篇')).toBeTruthy());

    expect(within(reader).getByRole('button', { name: /上一篇/ })).toHaveProperty('disabled', true);
    expect(within(reader).getByRole('button', { name: /下一篇/ })).toHaveProperty('disabled', true);
  });

  it('shows the 串接 of a post straight from the list + button', async () => {
    stubFetch([post(1), post(2), post(3)]);
    render(<SavedPostsPage />);

    const [plus] = await screen.findAllByRole('button', { name: /^串接 / });
    fireEvent.click(plus);

    const thread = await screen.findByRole('dialog', { name: '串接閱讀' });
    await waitFor(() =>
      expect(within(thread).getByText('看板《Chat》 · 共 3 篇 · 完成')).toBeTruthy(),
    );
    expect(thread.querySelectorAll('.bbs-thread-post')).toHaveLength(3);
    expect(screen.queryByRole('dialog', { name: '文章內容' })).toBeNull();

    fireEvent.click(within(thread).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '串接閱讀' })).toBeNull());
    expect(screen.queryByRole('dialog', { name: '文章內容' })).toBeNull();
  });

  it('falls back to an error reader when the thread fetch fails from +', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/posts?')) {
          return json({ posts: [post(1)], total: 1, page: 1, limit: 20 });
        }
        if (url.endsWith('/thread')) {
          return { ok: false, json: async () => ({}) } as unknown as Response;
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    render(<SavedPostsPage />);

    const [plus] = await screen.findAllByRole('button', { name: /^串接 / });
    fireEvent.click(plus);

    expect(await screen.findByText(/載入失敗/)).toBeTruthy();
  });
});
