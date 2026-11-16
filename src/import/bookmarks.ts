import type { Item, PinnedTab, Skipped, Space } from '../model';
import { classifyUrl } from './urls';

export interface BookmarkNode { id: string; title: string; url?: string; children?: BookmarkNode[] }

/** The chrome.bookmarks subset the bookmark copy needs. */
export interface BookmarksApi {
  getTree(): Promise<BookmarkNode[]>;
  create(bookmark: { parentId: string; title: string; url?: string }): Promise<BookmarkNode>;
  removeTree(id: string): Promise<void>;
}

export interface BookmarkSummary { foldersCreated: number; bookmarksCreated: number; skipped: Skipped[] }

const SEP = ' – ';

/** Writes "Arc – <space>" folders (and "Arc – Favorites") under Other bookmarks, replacing earlier copies. */
export async function writeBookmarkCopy(api: BookmarksApi, spaces: Space[], favorites: Record<string, PinnedTab[]>): Promise<BookmarkSummary> {
  const summary: BookmarkSummary = { foldersCreated: 0, bookmarksCreated: 0, skipped: [] };
  const [root] = await api.getTree();
  const tops = root?.children ?? [];
  const other = tops.find((c) => c.id === '2') ?? tops[1];
  if (!other) throw new Error('No "Other bookmarks" folder found');
  // Existing folders at the top two levels below the root folders, by title.
  const existing = tops.flatMap((t) => (t.children ?? []).flatMap((c) => [c, ...(c.children ?? [])])).filter((c) => !c.url);

  const folder = async (parentId: string, title: string) => {
    summary.foldersCreated++;
    return (await api.create({ parentId, title })).id;
  };
  const writeTab = async (parentId: string, t: PinnedTab) => {
    const title = t.customName ?? (t.title || t.url);
    if (classifyUrl(t.url) === 'skip') return void summary.skipped.push({ reason: 'unsupported URL', title });
    await api.create({ parentId, title, url: t.url });
    summary.bookmarksCreated++;
  };
  const writeItems = async (parentId: string, items: Item[]): Promise<void> => {
    for (const item of items) {
      if (item.kind === 'tab') await writeTab(parentId, item);
      else if (item.kind === 'note') summary.skipped.push({ reason: 'note', title: item.title });
      else if (item.kind === 'split') await writeItems(await folder(parentId, 'Split View'), item.tabs);
      else await writeItems(await folder(parentId, item.name), item.children);
    }
  };
  const topFolder = async (title: string) => {
    for (const old of existing.filter((c) => c.title === title)) await api.removeTree(old.id).catch(() => {}); // may already be gone with its parent
    return folder(other.id, title);
  };

  for (const space of spaces) {
    const id = await topFolder(`Arc${SEP}${space.name}`);
    await writeItems(id, space.pinned);
    if (space.today.length) await writeItems(await folder(id, 'Today'), space.today);
  }
  const favs = [...new Set(spaces.map((s) => s.arcProfile))].flatMap((p) => favorites[p] ?? []);
  if (favs.length) await writeItems(await topFolder(`Arc${SEP}Favorites`), favs);
  return summary;
}
