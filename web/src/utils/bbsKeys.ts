/**
 * Mapping between BBS key labels (as printed in the terminal legend) and the
 * byte sequences sent to the BBS.
 *
 * BBS navigation keys are almost always single characters (no Enter needed):
 *   q 離開, h 說明, b 進板公告, g 推薦, / 搜尋, s 看板, c 蒐尋
 * Arrow keys and Page/Home/End are ANSI escape sequences.
 * `^X` denotes a Control combination.
 */

export const KEY = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  home: '\x1b[1~',
  end: '\x1b[4~',
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  backspace: '\x7f',
} as const;

const ARROWS: Record<string, string> = {
  '↑': KEY.up,
  '↓': KEY.down,
  '→': KEY.right,
  '←': KEY.left,
  'PgUp': KEY.pageUp,
  'PgDn': KEY.pageDown,
  'PageUp': KEY.pageUp,
  'PageDown': KEY.pageDown,
  'Home': KEY.home,
  'End': KEY.end,
  'TAB': KEY.tab,
  'Tab': KEY.tab,
  'ESC': KEY.escape,
  'Enter': KEY.enter,
  'Bksp': KEY.backspace,
};

/**
 * Convert a legend label such as "←", "^P", "TAB" or "g" into the sequence to
 * send to the BBS. Returns null when the label is not actionable.
 */
export function legendKeyToSequence(label: string): string | null {
  const key = label.trim();
  if (!key) return null;

  const upper = key.toUpperCase();
  if (ARROWS[key]) return ARROWS[key];
  if (ARROWS[upper]) return ARROWS[upper];

  // Control combination: ^P, ^Y, ^C ...
  const ctrl = key.match(/^\^(.+)$/);
  if (ctrl && ctrl[1].length === 1) {
    return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f);
  }

  // Multi-character key groups like "f/a/d/M" -> first meaningful key.
  if (key.includes('/')) {
    const first = key.split('/')[0];
    return first.length === 1 ? first : null;
  }

  if (key.length === 1) return key;
  return null;
}

/** Best-effort action sequence for a named navigation command. */
export function navSequence(action: 'back' | 'quit' | 'read' | 'help'): string {
  switch (action) {
    case 'back':
      return KEY.left;
    case 'quit':
      return 'q';
    case 'read':
      return KEY.right;
    case 'help':
      return 'h';
  }
}
