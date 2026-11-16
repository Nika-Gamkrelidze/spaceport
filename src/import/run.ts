import type { ArcSetup, Item, Rgb, Skipped } from '../model';
import { applyImport, emptyLibrary, loadLibrary, planImport, saveLibrary, type Decision, type ImportStatus, type Library, type StorageArea } from '../store/library';
import { decodeTransfer, encodeTransfer } from '../transfer/transfer';
import { writeBookmarkCopy, type BookmarksApi } from './bookmarks';
import { createFolderGroups, type GroupsApi } from './groups';

/** 'space': one space group per space, tabs opened later from the sidebar. 'folder': one folder group per folder, opened now. */
export type GroupMode = 'space' | 'folder';

export interface SpacePreview {
  sourceId: string; name: string; status: ImportStatus; arcProfile: string; color?: Rgb;
  pinned: number; folders: number; today: number;
}

export interface ImportRequest { setup: ArcSetup; spaceIds: string[]; mode: GroupMode; decisions: Record<string, Decision> }

export interface ImportReport {
  spaces: { name: string; outcome: 'added' | 'replaced' | 'kept' | 'copied' }[];
  bookmarksCreated: number; groupsCreated: number; tabsOpened: number;
  failedUrls: string[]; skipped: Skipped[];
  /** True when spaces were replaced and the previous library was saved for undo. */
  undoAvailable: boolean;
}

export interface ImportDeps { bookmarks: BookmarksApi; groups: GroupsApi; storage: StorageArea; now: () => Date }

/** Pinned tabs (inside folders and split views too) and folders at every depth. */
function count(items: Item[]): { pinned: number; folders: number } {
  let pinned = 0, folders = 0;
  for (const i of items) {
    if (i.kind === 'tab') pinned++;
    else if (i.kind === 'split') pinned += i.tabs.length;
    else if (i.kind === 'folder') { const c = count(i.children); pinned += c.pinned; folders += c.folders + 1; }
  }
  return { pinned, folders };
}

export function previewSpaces(lib: Library, setup: ArcSetup): SpacePreview[] {
  return planImport(lib, setup.spaces).map((p, i) => {
    const sp = setup.spaces[i]!;
    return { ...p, arcProfile: sp.arcProfile, ...(sp.color ? { color: sp.color } : {}), ...count(sp.pinned), today: sp.today.length };
  });
}
export const UNDO_KEY = 'undoSnapshot';
const OUTCOME = { replace: 'replaced', keep: 'kept', copy: 'copied' } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runImport(deps: ImportDeps, req: ImportRequest): Promise<ImportReport> {
  const { setup, decisions } = req;
  const chosen = setup.spaces.filter((s) => req.spaceIds.includes(s.id));
  const lib = await loadLibrary(deps.storage);
  // Mirrors applyImport's default: an edited space is kept unless the person decided otherwise.
  const spaces = planImport(lib, chosen).map((p) => ({
    name: p.name,
    outcome: p.status === 'new' ? 'added' as const : OUTCOME[decisions[p.sourceId] ?? (p.status === 'conflict' ? 'keep' : 'replace')],
  }));

  const undoAvailable = spaces.some((s) => s.outcome === 'replaced');
  if (undoAvailable) {
    const snapshot = await encodeTransfer({ spaces: lib.spaces.map((s) => s.space), favorites: lib.favorites, skipped: [] }, { now: deps.now() });
    await deps.storage.set({ [UNDO_KEY]: snapshot });
  }

  const favorites = Object.fromEntries([...new Set(chosen.map((s) => s.arcProfile))]
    .flatMap((p) => (setup.favorites[p] ? [[p, setup.favorites[p]]] : [])));
  const next = applyImport(lib, chosen, decisions, deps.now());
  await saveLibrary(deps.storage, { ...next, favorites: { ...next.favorites, ...favorites } });

  // applyImport keeps untouched entries as the same objects, so new objects are the added/replaced/copied spaces.
  const changed = next.spaces.filter((s) => !lib.spaces.includes(s)).map((s) => s.space);
  const report: ImportReport = { spaces, bookmarksCreated: 0, groupsCreated: 0, tabsOpened: 0, failedUrls: [], skipped: [...setup.skipped], undoAvailable };
  if (!changed.length) return report;

  // The library is already saved: browser-side failures go into the report instead of throwing.
  try {
    const b = await writeBookmarkCopy(deps.bookmarks, changed, favorites);
    report.bookmarksCreated = b.bookmarksCreated;
    report.skipped.push(...b.skipped);
  } catch (e) {
    report.skipped.push({ reason: `bookmark copy failed: ${message(e)}` });
  }
  if (req.mode === 'folder') {
    for (const space of changed) {
      try {
        const g = await createFolderGroups(deps.groups, space, {});
        report.groupsCreated += g.groupsCreated;
        report.tabsOpened += g.tabsOpened;
        report.failedUrls.push(...g.failed);
      } catch (e) {
        report.skipped.push({ reason: `tab groups failed: ${message(e)}`, title: space.name });
      }
    }
  }
  return report;
}
/** Restores the library saved before the last replacing import. Bookmark copies and tab groups it made are not rolled back. */
export async function undoLastImport(deps: Pick<ImportDeps, 'storage'>): Promise<boolean> {
  const text = (await deps.storage.get(UNDO_KEY))[UNDO_KEY];
  if (typeof text !== 'string') return false;
  const decoded = await decodeTransfer(text);
  if (!decoded.ok) return false;
  // shortcut: restored spaces count as freshly imported (edit marks and copy links reset); keep StoredSpace in the snapshot if that matters.
  const lib = applyImport(emptyLibrary(), decoded.setup.spaces, {}, new Date(decoded.createdAt || Date.now()));
  await saveLibrary(deps.storage, { ...lib, favorites: decoded.setup.favorites });
  // StorageArea has no remove(); null marks the snapshot as used.
  await deps.storage.set({ [UNDO_KEY]: null });
  return true;
}
