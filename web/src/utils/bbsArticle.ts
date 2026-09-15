export function articleLineClass(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('>')) return 'bbs-article-line bbs-article-quote';
  if (trimmed.startsWith('--') || trimmed.startsWith('※')) return 'bbs-article-line bbs-article-dim';
  return 'bbs-article-line';
}
