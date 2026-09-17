import type { BbsPage } from '../../utils/bbsScreen';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * High-level actions exposed by the live BBS session. Every action is
 * page-aware: `open(index)` means "activate the item at list position `index`
 * on whatever page is currently shown".
 */
export interface BbsActions {
  /** Move the BBS cursor to a list position (sends arrow keys). */
  select(index: number): void;
  /** Activate a list position: enter a menu item, open a board or a post. */
  open(index: number): void;
  up(): void;
  down(): void;
  left(): void;
  right(): void;
  enter(): void;
  pageUp(): void;
  pageDown(): void;
  home(): void;
  end(): void;
  back(): void;
  quit(): void;
  startSearch(): void;
  submitSearch(query: string): void;
  cancelSearch(): void;
  /** Same-thread (同主題/串接) navigation from an article. */
  threadFirst(): void;
  threadPrev(): void;
  threadNext(): void;
  /** Collect every post in the current thread and open the scrollable reader. */
  readThread(): void;
  /** Open the native reply composer for the current article. */
  openComposer(): void;
  /** Submit a login field value and remember it for auto-reconnect. */
  submitLogin(field: 'username' | 'password', value: string): void;
  /** Send a typed value to the BBS prompt that is currently waiting for input. */
  submitPrompt(value: string): void;
  /** Send a raw byte or escape sequence to the BBS. */
  raw(seq: string): void;
}

export interface ThreadArticle {
  title: string;
  author: string;
  board: string;
  date: string;
  body: string[];
}

export interface ThreadReaderState {
  board: string;
  title: string;
  articles: ThreadArticle[];
  status: 'collecting' | 'done';
}

export type ReplyDestination = 'F' | 'M' | 'B';
export type ReplyQuote = 'Y' | 'N' | 'All';

export interface ReplyDraft {
  destination: ReplyDestination;
  category: string;
  title: string;
  quote: ReplyQuote;
  signature: string;
  body: string;
}

export interface ComposerState {
  board: string;
  title: string;
  status: 'editing' | 'sending' | 'done' | 'error';
  message?: string;
}

export interface BbsBrowserShellProps {
  page: BbsPage | null;
  status: ConnectionStatus;
  statusText?: string;
  busy?: boolean;
  error?: string | null;
  breadcrumbs?: string[];
  actions: BbsActions;
  onConnect(): void;
  onDisconnect(): void;
  onToggleRaw?(): void;
  onOpenSettings?(): void;
}
