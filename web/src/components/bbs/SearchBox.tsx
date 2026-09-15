import { useState, type KeyboardEvent } from 'react';
import type { BbsActions } from './types';

export interface SearchBoxProps {
  actions: BbsActions;
  placeholder?: string;
}

/**
 * Inline search field shared by the board and post list pages. Focusing the
 * field tells the session to enter search mode; Enter submits the query and
 * Escape cancels it.
 */
export function SearchBox({ actions, placeholder }: SearchBoxProps) {
  const [query, setQuery] = useState('');

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.submitSearch(query);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      actions.cancelSearch();
    }
  };

  return (
    <div className="bbs-searchbox">
      <input
        className="bbs-input bbs-search-input"
        type="search"
        value={query}
        placeholder={placeholder ?? '搜尋'}
        aria-label="搜尋"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => actions.startSearch()}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
