import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';
import { PromptInput } from './PromptInput';

type PostListBbsPage = Extract<BbsPage, { kind: 'postList' }>;

export interface PostListPageProps {
  page: PostListBbsPage;
  actions: BbsActions;
}

/** Article list for a board. Rows and the 閱讀 button open the article. */
export function PostListPage({ page, actions }: PostListPageProps) {
  return (
    <section className="bbs-postlist" aria-label="文章列表">
      {page.prompt && <PromptInput prompt={page.prompt} onSubmit={actions.submitPrompt} />}

      <div className="bbs-table-wrap">
        <table className="bbs-table bbs-table--posts">
          <thead>
            <tr>
              <th className="bbs-col-idx">#</th>
              <th className="bbs-col-postno">編號</th>
              <th className="bbs-col-status">標記</th>
              <th className="bbs-col-date">日期</th>
              <th className="bbs-col-author">作者</th>
              <th className="bbs-col-title">標題</th>
              <th className="bbs-col-action" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {page.items.length === 0 ? (
              <tr>
                <td className="bbs-empty" colSpan={7}>
                  沒有文章
                </td>
              </tr>
            ) : (
              page.items.map((item, index) => (
                <tr
                  key={item.postno}
                  className={`bbs-row${index === page.selectedIndex ? ' bbs-row-selected' : ''}`}
                  onClick={() => actions.open(index)}
                >
                  <td className="bbs-cell-idx">
                    {index + 1}
                  </td>
                  <td className="bbs-cell-postno">
                    {item.postno}
                  </td>
                  <td className="bbs-cell-mark">
                    {item.mark}
                  </td>
                  <td className="bbs-cell-date">
                    {item.date}
                  </td>
                  <td className="bbs-cell-author">
                    {item.author}
                  </td>
                  <td className="bbs-cell-title">
                    {item.title}
                  </td>
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
