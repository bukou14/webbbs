import { useMemo, useState } from 'react';
import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';

type PostListBbsPage = Extract<BbsPage, { kind: 'postList' }>;

export interface PostListPageProps {
  page: PostListBbsPage;
  actions: BbsActions;
}

/** Article list for a board. Rows and the 閱讀 button open the article. */
export function PostListPage({ page, actions }: PostListPageProps) {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      page.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) =>
          !query || item.title.toLowerCase().includes(query) || item.author.toLowerCase().includes(query),
        ),
    [page.items, query],
  );

  return (
    <section className="bbs-postlist" aria-label="文章列表">
      <header className="bbs-page-head">
        <h1 className="bbs-page-title">{page.board || page.header.title || '文章列表'}</h1>
        <p className="bbs-page-sub">
          看板《{page.board}》 · 第 {page.page} 頁 · 共 {page.items.length} 篇
        </p>
      </header>

      <div className="bbs-searchbox">
        <input
          className="bbs-input bbs-search-input"
          type="search"
          value={filter}
          placeholder="篩選標題或作者"
          aria-label="篩選文章"
          spellCheck={false}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      <div className="bbs-table-wrap">
        <table className="bbs-table bbs-table--posts">
          <thead>
            <tr>
              <th className="bbs-col-idx">#</th>
              <th>編號</th>
              <th className="bbs-col-status">標記</th>
              <th>日期</th>
              <th>作者</th>
              <th>標題</th>
              <th className="bbs-col-action" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td className="bbs-empty" colSpan={7}>
                  沒有符合「{filter}」的文章
                </td>
              </tr>
            ) : (
              visible.map(({ item, index }) => (
                <tr
                  key={item.postno}
                  className={`bbs-row${index === page.selectedIndex ? ' bbs-row-selected' : ''}`}
                  onClick={() => actions.open(index)}
                >
                  <td className="bbs-cell-idx">{index + 1}</td>
                  <td className="bbs-cell-postno">{item.postno}</td>
                  <td className="bbs-cell-mark">{item.mark}</td>
                  <td className="bbs-cell-date">{item.date}</td>
                  <td className="bbs-cell-author">{item.author}</td>
                  <td className="bbs-cell-title">{item.title}</td>
                  <td className="bbs-cell-action">
                    <button
                      type="button"
                      className="bbs-row-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        actions.open(index);
                      }}
                    >
                      閱讀
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
