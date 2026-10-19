import { useEffect, useState } from 'react';
import { useSavedPosts } from '../hooks/useSavedPosts';
import type { SavedPost } from '../hooks/useSavedPosts';
import { ThreadReader } from './bbs/ThreadReader';
import type { ThreadReaderState } from './bbs/types';
import { articleLineClass } from '../utils/bbsArticle';
import './bbs/bbs.css';
import './SavedPosts.css';

const BOARD = 'Chat';

/** BBS article number shown in the list's 編號 column (`bbs_chat_62966` -> 62966). */
function articleNo(postno: string): string {
  const match = /(\d+)\s*$/.exec(postno);
  return match ? match[1] : postno;
}

/**
 * Posts saved in the backend cache (`GET /api/posts`), laid out like the BBS 文章列表
 * screen. Opening a row fetches its 同主題 thread, so the reader offers the same
 * 首篇 / 上一篇 / 下一篇 and 串接閱讀全部 controls as the live article page. The `+`
 * column reads that thread straight from the list.
 */
export function SavedPostsPage() {
  const {
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
  } = useSavedPosts();
  const [showThread, setShowThread] = useState(false);
  const [threadFromList, setThreadFromList] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // A failed thread fetch must not vanish behind the open thread reader: drop back
  // to the article overlay, which renders `detailError` as 載入失敗.
  useEffect(() => {
    if (detailError) setShowThread(false);
  }, [detailError]);

  const closeReader = () => {
    setShowThread(false);
    setThreadFromList(false);
    closePost();
  };

  // Closing a `+`-opened thread returns to the list; closing one opened from the
  // article reader returns to that reader.
  const closeThreadReader = () => {
    if (threadFromList) closeReader();
    else setShowThread(false);
  };

  const openThread = (post: SavedPost) => {
    setThreadFromList(true);
    openPost(post.id);
    setShowThread(true);
  };

  const targetPost = selectedId !== null ? posts.find((p) => p.id === selectedId) ?? null : null;

  const threadReader: ThreadReaderState | null =
    showThread && !detailError
      ? {
          board: BOARD,
          title: threadSubject || targetPost?.title || '',
          articles: thread.map((post) => ({
            title: post.title || '(無標題)',
            author: post.author || '',
            board: BOARD,
            date: post.date || '',
            body: (post.content || '').split('\n'),
          })),
          status: detailLoading ? 'collecting' : 'done',
        }
      : null;

  return (
    <section className="bbs-shell saved-posts" aria-label="存檔文章">
      <header className="bbs-toolbar">
        <div className="bbs-toolbar-main">
          <h1 className="bbs-shell-title">存檔文章</h1>
          <span className="bbs-status-text" role="status">
            看板《{BOARD}》· 共 {total} 篇 · 第 {page} / {totalPages} 頁
          </span>
          <div className="bbs-toolbar-spacer" />
          <div className="bbs-toolbar-actions">
            <button type="button" onClick={refresh} disabled={loading}>
              ↻ 重新整理
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="bbs-error" role="alert">
          <span className="bbs-error-icon" aria-hidden="true">
            !
          </span>
          <span>載入失敗：{error}</span>
        </div>
      )}

      <main className="bbs-body" aria-busy={loading ? 'true' : undefined}>
        {loading && posts.length === 0 ? (
          <div className="bbs-loading">
            <span className="bbs-loading-dot" aria-hidden="true" />
            <p>載入中…</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="saved-posts-empty">
            <p className="saved-posts-empty-title">尚無存檔文章</p>
            <p className="saved-posts-hint">
              執行 <code>POST /api/crawler/crawl</code> 以抓取文章
            </p>
          </div>
        ) : (
          <div className="bbs-table-wrap">
            <table className="bbs-table bbs-table--posts">
              <thead>
                <tr>
                  <th className="bbs-col-idx">#</th>
                  <th className="bbs-col-postno">編號</th>
                  <th className="bbs-col-thread" aria-label="串接" />
                  <th className="bbs-col-status">標記</th>
                  <th className="bbs-col-date">日期</th>
                  <th className="bbs-col-author">作者</th>
                  <th className="bbs-col-title">標題</th>
                  <th className="bbs-col-action" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {posts.map((post, index) => (
                  <tr key={post.id} className="bbs-row" onClick={() => openPost(post.id)}>
                    <td className="bbs-cell-idx">{(page - 1) * limit + index + 1}</td>
                    <td className="bbs-cell-postno">{articleNo(post.postno)}</td>
                    <td className="bbs-cell-thread">
                      <button
                        type="button"
                        className="bbs-row-thread"
                        aria-label={`串接 ${post.title || '文章'}`}
                        title="串接閱讀"
                        onClick={(event) => {
                          event.stopPropagation();
                          openThread(post);
                        }}
                      >
                        +
                      </button>
                    </td>
                    <td className="bbs-cell-mark">{post.mark || ''}</td>
                    <td className="bbs-cell-date">{post.date || ''}</td>
                    <td className="bbs-cell-author">{post.author || ''}</td>
                    <td className="bbs-cell-title">{post.title || '(無標題)'}</td>
                    <td className="bbs-cell-action">
                      <button
                        type="button"
                        className="bbs-row-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          openPost(post.id);
                        }}
                      >
                        閱讀
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer className="bbs-keybar">
        <div className="bbs-keybar-scroll">
          <button
            type="button"
            className="bbs-nav-btn"
            onClick={() => loadPage(page - 1)}
            disabled={page <= 1 || loading}
          >
            ← 上一頁
          </button>
          <span className="bbs-status-text">
            第 {page} / {totalPages} 頁
          </span>
          <button
            type="button"
            className="bbs-nav-btn"
            onClick={() => loadPage(page + 1)}
            disabled={page >= totalPages || loading}
          >
            下一頁 →
          </button>
        </div>
      </footer>

      {(selectedPost || detailLoading || detailError) && !showThread && (
        <div
          className="bbs-shell saved-posts-reader"
          role="dialog"
          aria-modal="true"
          aria-label="文章內容"
        >
          <article className="bbs-article">
            <header className="bbs-article-head">
              <h1 className="bbs-article-title">
                {selectedPost?.title || (detailLoading ? '載入中…' : '(無標題)')}
              </h1>
              {selectedPost && (
                <dl className="bbs-article-meta">
                  <div>
                    <dt>作者</dt>
                    <dd>{selectedPost.author || ''}</dd>
                  </div>
                  <div>
                    <dt>看板</dt>
                    <dd>{BOARD}</dd>
                  </div>
                  <div>
                    <dt>時間</dt>
                    <dd>{selectedPost.date || ''}</dd>
                  </div>
                  <div>
                    <dt>編號</dt>
                    <dd>{articleNo(selectedPost.postno)}</dd>
                  </div>
                </dl>
              )}
            </header>

            <div className="bbs-article-thread" role="group" aria-label="同主題串接">
              <span className="bbs-thread-label">同主題串接</span>
              <button
                type="button"
                className="bbs-nav-btn"
                onClick={threadFirst}
                disabled={!hasPrev}
              >
                ⏮ 首篇
              </button>
              <button type="button" className="bbs-nav-btn" onClick={threadPrev} disabled={!hasPrev}>
                ◀ 上一篇
              </button>
              <button type="button" className="bbs-nav-btn" onClick={threadNext} disabled={!hasNext}>
                下一篇 ▶
              </button>
              <button
                type="button"
                className="bbs-nav-btn bbs-thread-read-btn"
                onClick={() => {
                  setThreadFromList(false);
                  setShowThread(true);
                }}
                disabled={thread.length === 0}
              >
                📖 串接閱讀全部
              </button>
              <span className="saved-posts-thread-pos">
                {threadIndex >= 0 ? `第 ${threadIndex + 1} / ${thread.length} 篇` : '讀取中…'}
              </span>
            </div>

            {detailError && (
              <div className="bbs-error" role="alert">
                <span className="bbs-error-icon" aria-hidden="true">
                  !
                </span>
                <span>載入失敗：{detailError}</span>
              </div>
            )}

            {detailLoading && (
              <div className="bbs-loading">
                <span className="bbs-loading-dot" aria-hidden="true" />
                <p>載入中…</p>
              </div>
            )}

            {selectedPost && (
              <div className="bbs-article-body">
                {(selectedPost.content || '(無內容)').split('\n').map((line, index) => (
                  <div key={index} className={articleLineClass(line)}>
                    {line || '\u00a0'}
                  </div>
                ))}
              </div>
            )}

            <footer className="bbs-article-foot">
              <span className="bbs-article-page">同主題共 {thread.length} 篇</span>
              <div className="bbs-article-actions">
                <button type="button" className="bbs-nav-btn" onClick={closeReader}>
                  ← 離開
                </button>
              </div>
            </footer>
          </article>
        </div>
      )}

      {threadReader && <ThreadReader reader={threadReader} onClose={closeThreadReader} />}
    </section>
  );
}
