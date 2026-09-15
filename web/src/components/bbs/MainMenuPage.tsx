import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';

type MenuBbsPage = Extract<BbsPage, { kind: 'menu' }>;

export interface MainMenuPageProps {
  page: MenuBbsPage;
  actions: BbsActions;
}

/**
 * Main function menu. Clicking an item activates it; hovering only moves the
 * visual focus and never sends a select to the BBS (keyboard selection is
 * handled by the shell).
 */
export function MainMenuPage({ page, actions }: MainMenuPageProps) {
  const site = page.header.site ?? '巴哈姆特';
  const board = page.header.board;

  return (
    <section className="bbs-menu" aria-label="主功能表">
      <header className="bbs-page-head">
        <h1 className="bbs-page-title">{page.header.title || '主功能表'}</h1>
        <p className="bbs-page-sub">
          {site}
          {board ? ` · 看板《${board}》` : ''}
        </p>
      </header>

      <ul className="bbs-menu-list">
        {page.items.map((item, index) => {
          const selected = index === page.selectedIndex;
          return (
            <li key={item.key}>
              <button
                type="button"
                className={`bbs-menu-item${selected ? ' bbs-selected' : ''}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => actions.open(index)}
              >
                <span className="bbs-menu-key" aria-hidden="true">
                  {item.key}
                </span>
                <span className="bbs-menu-label">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {page.footer.length > 0 && <footer className="bbs-page-footer">{page.footer.join('   ')}</footer>}
    </section>
  );
}
