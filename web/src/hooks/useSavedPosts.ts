import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** A row of the `posts` table as returned by `GET /api/posts`. */
export interface SavedPost {
  id: number;
  postno: string;
  title: string | null;
  author: string | null;
  date: string | null;
  first_posted_at: string | null;
  /** Thread topic with the reply prefix (`Re: `, `=> `) stripped. */
  subject: string | null;
  /** Board-list marker, e.g. `m` for a 板主標記 post. */
  mark: string | null;
  content: string | null;
  created_at: string | null;
}

interface SavedPostsResult {
  posts: SavedPost[];
  total: number;
  page: number;
  limit: number;
}

interface SavedThreadResult {
  subject: string;
  posts: SavedPost[];
}

export interface SavedPostsState {
  posts: SavedPost[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string | null;
  /** Id of the post currently being read (its thread is loading or loaded), or null. */
  selectedId: number | null;
  /** The post shown in the reader, taken from the loaded thread. */
  selectedPost: SavedPost | null;
  /** Every saved post of the same 同主題 subject, oldest first. */
  thread: SavedPost[];
  threadSubject: string | null;
  /** Position of `selectedPost` inside `thread`, or -1 while loading. */
  threadIndex: number;
  detailLoading: boolean;
  detailError: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  loadPage(page: number): void;
  openPost(id: number): void;
  closePost(): void;
  threadFirst(): void;
  threadPrev(): void;
  threadNext(): void;
  refresh(): void;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Reads the posts saved in the backend SQLite cache through the REST API.
 * Relative URLs work under the Vite dev proxy and in the single-port production
 * build (where `ws-proxy.mjs` serves this app from the same origin).
 *
 * Opening a post also loads its 同主題 thread, so the reader can offer the same
 * 首篇 / 上一篇 / 下一篇 / 串接閱讀全部 controls as the live BBS article page.
 */
export function useSavedPosts(initialLimit = 20): SavedPostsState {
  const [limit] = useState(initialLimit);
  const [page, setPage] = useState(1);
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<SavedPost[]>([]);
  const [threadSubject, setThreadSubject] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Monotonic guards so a slow response can never overwrite a newer one.
  const listSeq = useRef(0);
  const threadSeq = useRef(0);

  const loadPage = useCallback(
    (next: number) => {
      const seq = ++listSeq.current;
      setLoading(true);
      setError(null);
      getJson<SavedPostsResult>(`/api/posts?page=${next}&limit=${limit}`)
        .then((data) => {
          if (seq !== listSeq.current) return;
          setPosts(data.posts);
          setTotal(data.total);
          setPage(data.page);
        })
        .catch((err: unknown) => {
          if (seq !== listSeq.current) return;
          setError(err instanceof Error ? err.message : '載入失敗');
        })
        .finally(() => {
          if (seq === listSeq.current) setLoading(false);
        });
    },
    [limit],
  );

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  const openPost = useCallback((id: number) => {
    const seq = ++threadSeq.current;
    setSelectedId(id);
    setThread([]);
    setThreadSubject(null);
    setDetailError(null);
    setDetailLoading(true);
    getJson<SavedThreadResult>(`/api/posts/${id}/thread`)
      .then((data) => {
        if (seq !== threadSeq.current) return;
        setThread(data.posts);
        setThreadSubject(data.subject);
      })
      .catch((err: unknown) => {
        if (seq !== threadSeq.current) return;
        setDetailError(err instanceof Error ? err.message : '載入失敗');
      })
      .finally(() => {
        if (seq === threadSeq.current) setDetailLoading(false);
      });
  }, []);

  const closePost = useCallback(() => {
    threadSeq.current += 1; // invalidate any in-flight thread fetch
    setSelectedId(null);
    setThread([]);
    setThreadSubject(null);
    setDetailLoading(false);
    setDetailError(null);
  }, []);

  const threadIndex = useMemo(
    () => (selectedId === null ? -1 : thread.findIndex((post) => post.id === selectedId)),
    [thread, selectedId],
  );

  const selectedPost = useMemo(
    () => (threadIndex === -1 ? null : thread[threadIndex]),
    [thread, threadIndex],
  );

  const hasPrev = threadIndex > 0;
  const hasNext = threadIndex >= 0 && threadIndex < thread.length - 1;

  const threadFirst = useCallback(() => {
    if (thread.length > 0) setSelectedId(thread[0].id);
  }, [thread]);

  const threadPrev = useCallback(() => {
    if (threadIndex > 0) setSelectedId(thread[threadIndex - 1].id);
  }, [thread, threadIndex]);

  const threadNext = useCallback(() => {
    if (threadIndex >= 0 && threadIndex < thread.length - 1) {
      setSelectedId(thread[threadIndex + 1].id);
    }
  }, [thread, threadIndex]);

  const refresh = useCallback(() => loadPage(page), [loadPage, page]);

  return {
    posts,
    total,
    page,
    limit,
    loading,
    error,
    selectedId,
    selectedPost,
    thread,
    threadSubject,
    threadIndex,
    detailLoading,
    detailError,
    hasPrev,
    hasNext,
    loadPage,
    openPost,
    closePost,
    threadFirst,
    threadPrev,
    threadNext,
    refresh,
  };
}
