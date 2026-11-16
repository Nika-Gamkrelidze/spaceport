export type UrlClass = 'open' | 'bookmarkOnly' | 'skip';

const BOOKMARK_ONLY = new Set(['javascript:', 'file:', 'chrome:', 'edge:', 'about:', 'data:', 'chrome-extension:']);

/** Import opens only 'open' URLs; 'bookmarkOnly' goes to the bookmark copy; 'skip' is reported. */
export function classifyUrl(url: string): UrlClass {
  let protocol: string;
  try { protocol = new URL(url).protocol; } catch { return 'skip'; }
  if (protocol === 'http:' || protocol === 'https:') return 'open';
  return BOOKMARK_ONLY.has(protocol) ? 'bookmarkOnly' : 'skip';
}
