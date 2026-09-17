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
  return (
    <section className="bbs-boardlist" aria-label="看板列表">
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
                <td className="bbs-cell-idx" data-label="#">
                  {item.index}
                </td>
                <td className="bbs-cell-name" data-label="看板">
                  {item.name}
                </td>
                <td className="bbs-cell-status" data-label="狀態">
                  {item.status}
                </td>
                <td className="bbs-cell-desc" data-label="說明">
                  {item.description}
                </td>
                <td className="bbs-cell-mod" data-label="板主">
                  {item.moderator}
                </td>
                <td className="bbs-cell-action" data-label="操作">
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
