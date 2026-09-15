import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';

type NoticeBbsPage = Extract<BbsPage, { kind: 'notice' }>;

export interface NoticePageProps {
  page: NoticeBbsPage;
  actions: BbsActions;
}

/** System announcement / welcome screen. */
export function NoticePage({ page, actions }: NoticePageProps) {
  const text = page.lines.join('\n');
  const anyKey = /任意鍵/.test(text);

  return (
    <section className="bbs-notice" aria-label={page.title ?? '公告'}>
      {page.title && <h1 className="bbs-notice-title">{page.title}</h1>}
      <pre className="bbs-notice-body">{text}</pre>
      <button className="bbs-primary-btn" onClick={() => actions.enter()}>
        {anyKey ? '按任意鍵繼續' : '繼續'}
      </button>
    </section>
  );
}
