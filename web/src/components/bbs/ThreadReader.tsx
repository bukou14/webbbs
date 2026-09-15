import type { ThreadReaderState } from './types';
import { articleLineClass } from '../../utils/bbsArticle';

export interface ThreadReaderProps {
  reader: ThreadReaderState;
  onClose: () => void;
}

export function ThreadReader({ reader, onClose }: ThreadReaderProps) {
  const loading = reader.status === 'collecting';
  return (
    <div className="bbs-shell bbs-thread-reader" role="dialog" aria-label="串接閱讀">
      <header className="bbs-thread-reader-head">
        <div className="bbs-thread-reader-info">
          <h2 className="bbs-thread-reader-title">{reader.title}</h2>
          <p className="bbs-thread-reader-sub">
            看板《{reader.board}》 · 共 {reader.articles.length} 篇
            {loading ? ' · 讀取中…' : ' · 完成'}
          </p>
        </div>
        <button type="button" className="bbs-nav-btn" onClick={onClose}>
          關閉
        </button>
      </header>

      <div className="bbs-thread-reader-body">
        {reader.articles.map((article, index) => (
          <section key={`${article.author}-${index}`} className="bbs-thread-post">
            <div className="bbs-thread-post-index">#{index + 1}</div>
            <h3 className="bbs-thread-post-title">{article.title}</h3>
            <div className="bbs-thread-post-meta">
              <span className="bbs-thread-post-author">{article.author}</span>
              <span className="bbs-thread-post-date">{article.date}</span>
            </div>
            <div className="bbs-thread-post-body">
              {article.body.map((line, lineIndex) => (
                <div key={lineIndex} className={articleLineClass(line)}>
                  {line || '\u00a0'}
                </div>
              ))}
            </div>
          </section>
        ))}

        {loading && (
          <div className="bbs-thread-loading">讀取下一篇…（已讀 {reader.articles.length} 篇）</div>
        )}
        {!loading && reader.articles.length === 0 && (
          <div className="bbs-thread-loading">此主題沒有可讀取的文章。</div>
        )}
      </div>
    </div>
  );
}
