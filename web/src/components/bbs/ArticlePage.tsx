import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';
import { legendKeyToSequence } from '../../utils/bbsKeys';
import { articleLineClass } from '../../utils/bbsArticle';

type ArticleBbsPage = Extract<BbsPage, { kind: 'article' }>;

export interface ArticlePageProps {
  page: ArticleBbsPage;
  actions: BbsActions;
}

/** Article reader. The BBS leaves an article with `q`, so Back sends quit(). */
export function ArticlePage({ page, actions }: ArticlePageProps) {
  return (
    <article className="bbs-article" aria-label="文章">
      <header className="bbs-article-head">
        <h1 className="bbs-article-title">{page.meta.title}</h1>
        <dl className="bbs-article-meta">
          <div>
            <dt>作者</dt>
            <dd>{page.meta.author}</dd>
          </div>
          <div>
            <dt>看板</dt>
            <dd>{page.meta.board}</dd>
          </div>
          <div>
            <dt>時間</dt>
            <dd>{page.meta.date}</dd>
          </div>
        </dl>
      </header>

      <div className="bbs-article-thread" role="group" aria-label="同主題串接">
        <span className="bbs-thread-label">同主題串接</span>
        <button type="button" className="bbs-nav-btn" onClick={() => actions.threadFirst()}>
          ⏮ 首篇
        </button>
        <button type="button" className="bbs-nav-btn" onClick={() => actions.threadPrev()}>
          ◀ 上一篇
        </button>
        <button type="button" className="bbs-nav-btn" onClick={() => actions.threadNext()}>
          下一篇 ▶
        </button>
        <button
          type="button"
          className="bbs-nav-btn bbs-thread-read-btn"
          onClick={() => actions.readThread()}
        >
          📖 串接閱讀全部
        </button>
      </div>

      <div className="bbs-article-body">
        {page.body.map((line, index) => (
          <div key={index} className={articleLineClass(line)}>
            {line || '\u00a0'}
          </div>
        ))}
      </div>

      <footer className="bbs-article-foot">
        <span className="bbs-article-page">第 {page.page} 頁</span>
        <div className="bbs-article-actions">
          <button type="button" className="bbs-nav-btn" onClick={() => actions.quit()}>
            ← 離開
          </button>
          <button
            type="button"
            className="bbs-nav-btn bbs-reply-btn"
            onClick={() => actions.openComposer()}
          >
            ✎ 回覆
          </button>
          {page.legend.map((item, index) => {
            const seq = legendKeyToSequence(item.key);
            return (
              <button
                key={`${item.key}-${index}`}
                type="button"
                className="bbs-key-btn"
                disabled={seq === null}
                aria-label={`${item.key} ${item.label}`}
                onClick={() => {
                  if (seq !== null) actions.raw(seq);
                }}
              >
                <span className="bbs-key-btn-key">{item.key}</span>
                {item.label && <span className="bbs-key-btn-label">{item.label}</span>}
              </button>
            );
          })}
        </div>
      </footer>
    </article>
  );
}
