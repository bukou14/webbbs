import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';
import { legendKeyToSequence } from '../../utils/bbsKeys';

type TextBbsPage = Extract<BbsPage, { kind: 'text' | 'unknown' | 'connecting' | 'ko' }>;

export interface TextPageProps {
  page: TextBbsPage;
  actions: BbsActions;
}

/** Generic monospace reading pane for plain / unrecognised screens. */
export function TextPage({ page, actions }: TextPageProps) {
  const chrome = page.kind === 'text' || page.kind === 'unknown';
  const header = 'header' in page ? page.header : undefined;
  const legend = 'legend' in page ? page.legend : [];
  const text = page.lines.join('\n');

  return (
    <section className="bbs-text" aria-label={header?.title ?? '內容'}>
      {header?.title && <h1 className="bbs-page-title">{header.title}</h1>}
      <pre className="bbs-text-body">{text || '\u00a0'}</pre>

      {chrome && (
        <div className="bbs-text-actions">
          <button type="button" className="bbs-nav-btn" onClick={() => actions.back()}>
            ← 返回
          </button>
          {legend.map((item, index) => {
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
      )}
    </section>
  );
}
