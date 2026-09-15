import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';
import { SearchBox } from './SearchBox';

type BoardListBbsPage = Extract<BbsPage, { kind: 'boardList' }>;

export interface BoardListPageProps {
  page: BoardListBbsPage;
  actions: BbsActions;
}

/** Board directory. Rows activate on click; the shell owns keyboard selection. */
export function BoardListPage({ page, actions }: BoardListPageProps) {
  const boardName = page.header.board ?? '尚未選定';

  return (
    <section className="bbs-boardlist" aria-label="看板列表">
      <header className="bbs-page-head">
        <h1 className="bbs-page-title">看板列表</h1>
        <p className="bbs-page-sub">
          看板《{boardName}》 · 共 {page.items.length} 個看板
        </p>
      </header>

      {page.prompt && (
        <div className="bbs-search-banner" role="status">
          {page.prompt}
        </div>
      )}

      <SearchBox actions={actions} placeholder="輸入看板名稱後按 Enter" />

      <div className="bbs-table-wrap">
        <table className="bbs-table bbs-table--boards">
          <thead>
            <tr>
              <th className="bbs-col-idx">#</th>
              <th>看板</th>
              <th className="bbs-col-status">狀態</th>
              <th>說明</th>
              <th className="bbs-col-mod">板主</th>
              <th className="bbs-col-action" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {page.items.map((item, index) => (
              <tr
                key={`${item.index}-${item.name}`}
                className={`bbs-row${index === page.selectedIndex ? ' bbs-row-selected' : ''}`}
                onClick={() => actions.open(index)}
              >
                <td className="bbs-cell-idx">{item.index}</td>
                <td className="bbs-cell-name">{item.name}</td>
                <td className="bbs-cell-status">{item.status}</td>
                <td className="bbs-cell-desc">{item.description}</td>
                <td className="bbs-cell-mod">{item.moderator}</td>
                <td className="bbs-cell-action">
                  <button
                    type="button"
                    className="bbs-row-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.open(index);
                    }}
                  >
                    進入
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
