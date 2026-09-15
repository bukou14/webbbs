import { useEffect, useMemo } from 'react';
import type { BbsPage, LegendItem } from '../../utils/bbsScreen';
import type { BbsActions, BbsBrowserShellProps } from './types';
import { legendKeyToSequence } from '../../utils/bbsKeys';
import { LoginPage } from './LoginPage';
import { NoticePage } from './NoticePage';
import { MainMenuPage } from './MainMenuPage';
import { BoardListPage } from './BoardListPage';
import { PostListPage } from './PostListPage';
import { ArticlePage } from './ArticlePage';
import { TextPage } from './TextPage';
import './bbs.css';

const NAV_BUTTONS: { label: string; run: (actions: BbsActions) => void }[] = [
  { label: '↑', run: (actions) => actions.up() },
  { label: '↓', run: (actions) => actions.down() },
  { label: '←', run: (actions) => actions.left() },
  { label: '→', run: (actions) => actions.right() },
  { label: '↵', run: (actions) => actions.enter() },
];

const PAGE_BUTTONS: { label: string; run: (actions: BbsActions) => void }[] = [
  { label: 'PgUp', run: (actions) => actions.pageUp() },
  { label: 'PgDn', run: (actions) => actions.pageDown() },
];

const STATUS_LABEL: Record<BbsBrowserShellProps['status'], string> = {
  disconnected: '未連線',
  connecting: '連線中…',
  connected: '已連線',
  reconnecting: '重新連線中…',
};

function deriveBreadcrumbs(page: BbsPage | null): string[] {
  if (!page || !('header' in page)) return [];
  const crumbs: string[] = [];
  if (page.header.title) crumbs.push(page.header.title);
  if (page.header.board) crumbs.push(`看板《${page.header.board}》`);
  return crumbs;
}

function renderPage(page: BbsPage, actions: BbsActions) {
  switch (page.kind) {
    case 'login':
      return <LoginPage page={page} actions={actions} />;
    case 'notice':
      return <NoticePage page={page} actions={actions} />;
    case 'menu':
      return <MainMenuPage page={page} actions={actions} />;
    case 'boardList':
      return <BoardListPage page={page} actions={actions} />;
    case 'postList':
      return <PostListPage page={page} actions={actions} />;
    case 'article':
      return <ArticlePage page={page} actions={actions} />;
    case 'text':
    case 'unknown':
    case 'connecting':
    case 'ko':
      return <TextPage page={page} actions={actions} />;
  }
}

/**
 * Chrome + router for the native BBS screens. Owns global keyboard navigation
 * and the function-key bar; the individual page components stay presentational.
 */
export function BbsBrowserShell({
  page,
  status,
  statusText,
  busy,
  error,
  breadcrumbs,
  actions,
  onConnect,
  onDisconnect,
  onToggleRaw,
}: BbsBrowserShellProps) {
  const crumbs = useMemo(
    () => (breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : deriveBreadcrumbs(page)),
    [breadcrumbs, page],
  );

  const legend: LegendItem[] = page && 'legend' in page ? page.legend : [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          actions.up();
          break;
        case 'ArrowDown':
          event.preventDefault();
          actions.down();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          actions.back();
          break;
        case 'ArrowRight':
          event.preventDefault();
          actions.right();
          break;
        case 'Enter':
          event.preventDefault();
          actions.enter();
          break;
        case 'PageUp':
          event.preventDefault();
          actions.pageUp();
          break;
        case 'PageDown':
          event.preventDefault();
          actions.pageDown();
          break;
        case 'Home':
          event.preventDefault();
          actions.home();
          break;
        case 'End':
          event.preventDefault();
          actions.end();
          break;
        default:
          if (event.key.toLowerCase() === 'q') {
            event.preventDefault();
            actions.quit();
          }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  const canConnect = status === 'disconnected';
  const canDisconnect = status !== 'disconnected';

  return (
    <div className="bbs-shell" data-bbs-kind={page?.kind ?? 'none'}>
      <header className="bbs-toolbar">
        <div className="bbs-toolbar-main">
          <span className={`status-indicator ${status}`} aria-hidden="true" />
          <span className="bbs-shell-title">巴哈姆特 BBS</span>
          <span className="bbs-status-text" role="status">
            {statusText ?? STATUS_LABEL[status]}
          </span>
          <div className="bbs-toolbar-spacer" />
          <div className="bbs-toolbar-actions">
            <button
              type="button"
              className="bbs-toolbar-primary"
              onClick={onConnect}
              disabled={!canConnect}
            >
              Connect
            </button>
            <button type="button" onClick={onDisconnect} disabled={!canDisconnect}>
              Disconnect
            </button>
            {onToggleRaw && (
              <button type="button" onClick={onToggleRaw}>
                Raw terminal
              </button>
            )}
          </div>
        </div>

        {crumbs.length > 0 && (
          <nav className="bbs-breadcrumbs" aria-label="Breadcrumb">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`}>
                {index > 0 && <span className="bbs-crumb-sep">›</span>}
                <span className="bbs-crumb">{crumb}</span>
              </span>
            ))}
          </nav>
        )}
      </header>

      {error && (
        <div className="bbs-error" role="alert">
          <span className="bbs-error-icon" aria-hidden="true">
            !
          </span>
          <span>{error}</span>
        </div>
      )}

      {busy && <div className="bbs-busy-bar" aria-hidden="true" />}

      <main className="bbs-body" aria-busy={busy ? 'true' : undefined}>
        {page === null ? (
          <div className="bbs-loading">
            <span className="bbs-loading-dot" aria-hidden="true" />
            <p>Connecting to 巴哈姆特 BBS...</p>
          </div>
        ) : (
          renderPage(page, actions)
        )}
      </main>

      <footer className="bbs-keybar">
        <div className="bbs-keybar-scroll">
          <div className="bbs-keybar-legend">
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
          <div className="bbs-keybar-nav">
            {NAV_BUTTONS.map((button) => (
              <button
                key={button.label}
                type="button"
                className="bbs-nav-btn"
                onClick={() => button.run(actions)}
              >
                {button.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bbs-keybar-fixed">
          {PAGE_BUTTONS.map((button) => (
            <button
              key={button.label}
              type="button"
              className="bbs-nav-btn"
              onClick={() => button.run(actions)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
