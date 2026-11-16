import type { Item, PinnedTab, Space } from '../model';
import type { Library } from './library';

/** Everything needed to put a removed item or space back where it was. */
export type Removed =
  | { kind: 'item'; spaceId: string; parentId: string | null; index: number; item: Item; from: 'pinned' | 'today' }
  | { kind: 'space'; index: number; space: Library['spaces'][number] };

/** Applies fn to one space; an unknown space id returns the library unchanged. */
function updateSpace(lib: Library, spaceId: string, fn: (s: Space) => Space): Library {
  if (!lib.spaces.some((s) => s.space.id === spaceId)) return lib;
  return { ...lib, spaces: lib.spaces.map((s) => (s.space.id === spaceId ? { ...s, space: fn(s.space) } : s)) };
}

/** Replaces the item with this id anywhere in the tree (folders and split views included). */
function mapItem<T extends Item>(items: T[], id: string, fn: (it: Item) => Item): T[] {
  return items.map((it) => {
    if (it.id === id) return fn(it) as T;
    if (it.kind === 'folder') return { ...it, children: mapItem(it.children, id, fn) };
    if (it.kind === 'split') return { ...it, tabs: mapItem(it.tabs, id, fn) };
    return it;
  });
}

function rename(it: Item, raw: string): Item {
  const name = raw.trim();
  if (it.kind === 'folder') return name ? { ...it, name } : it;
  if (it.kind === 'note') return name ? { ...it, title: name } : it;
  if (it.kind === 'split') return it;
  const { customName: _, ...rest } = it;
  return name && name !== it.title ? { ...rest, customName: name } : rest;
}

export function renameItem(lib: Library, spaceId: string, itemId: string, name: string): Library {
  const fn = (it: Item) => rename(it, name);
  return updateSpace(lib, spaceId, (s) => ({ ...s, pinned: mapItem(s.pinned, itemId, fn), today: mapItem(s.today, itemId, fn) as PinnedTab[] }));
}

export function renameSpace(lib: Library, spaceId: string, name: string): Library {
  const n = name.trim();
  return n ? updateSpace(lib, spaceId, (s) => ({ ...s, name: n })) : lib;
}

/** Takes the item with this id out of the pinned tree (searching folders), noting where it was. */
function take(items: Item[], id: string, parentId: string | null = null): { items: Item[]; item: Item; parentId: string | null; index: number } | null {
  const index = items.findIndex((it) => it.id === id);
  const item = items[index];
  if (item) return { items: items.filter((_, i) => i !== index), item, parentId, index };
  for (const [i, it] of items.entries()) {
    if (it.kind !== 'folder') continue;
    const hit = take(it.children, id, it.id);
    if (hit) return { ...hit, items: items.map((x, j) => (j === i ? { ...it, children: hit.items } : x)) };
  }
  return null;
}

const insertAt = <T>(items: T[], index: number, item: T): T[] => {
  const i = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, i), item, ...items.slice(i)];
};

/** Inserts into the folder with parentId (null = top level); null when that folder does not exist. */
function insert(items: Item[], parentId: string | null, index: number, item: Item): Item[] | null {
  if (parentId === null) return insertAt(items, index, item);
  let found = false;
  const out = items.map((it): Item => {
    if (found || it.kind !== 'folder') return it;
    if (it.id === parentId) { found = true; return { ...it, children: insertAt(it.children, index, item) }; }
    const children = insert(it.children, parentId, index, item);
    if (!children) return it;
    found = true;
    return { ...it, children };
  });
  return found ? out : null;
}

const spaceOf = (lib: Library, spaceId: string) => lib.spaces.find((s) => s.space.id === spaceId)?.space;

export function removeItem(lib: Library, spaceId: string, itemId: string): { lib: Library; removed: Removed | null } {
  const space = spaceOf(lib, spaceId);
  if (!space) return { lib, removed: null };
  const t = space.today.findIndex((it) => it.id === itemId);
  const todayTab = space.today[t];
  if (todayTab) {
    return {
      lib: updateSpace(lib, spaceId, (s) => ({ ...s, today: s.today.filter((_, i) => i !== t) })),
      removed: { kind: 'item', spaceId, parentId: null, index: t, item: todayTab, from: 'today' },
    };
  }
  const hit = take(space.pinned, itemId);
  if (!hit) return { lib, removed: null };
  return {
    lib: updateSpace(lib, spaceId, (s) => ({ ...s, pinned: hit.items })),
    removed: { kind: 'item', spaceId, parentId: hit.parentId, index: hit.index, item: hit.item, from: 'pinned' },
  };
}

export function removeSpace(lib: Library, spaceId: string): { lib: Library; removed: Removed | null } {
  const index = lib.spaces.findIndex((s) => s.space.id === spaceId);
  const space = lib.spaces[index];
  if (!space) return { lib, removed: null };
  return { lib: { ...lib, spaces: lib.spaces.filter((_, i) => i !== index) }, removed: { kind: 'space', index, space } };
}

export function restore(lib: Library, removed: Removed): Library {
  if (removed.kind === 'space') return { ...lib, spaces: insertAt(lib.spaces, removed.index, removed.space) };
  const { item, index, parentId } = removed;
  return updateSpace(lib, removed.spaceId, (s) => {
    if (removed.from === 'today' && item.kind === 'tab') return { ...s, today: insertAt(s.today, index, item) };
    return { ...s, pinned: insert(s.pinned, parentId, index, item) ?? [...s.pinned, item] };
  });
}

export function moveItem(lib: Library, spaceId: string, itemId: string, toParentId: string | null, index: number): Library {
  const { lib: without, removed } = removeItem(lib, spaceId, itemId);
  if (!removed || removed.kind !== 'item') return lib;
  // A folder moved into itself or a descendant finds no target once taken out, so it is refused here too.
  const pinned = insert(spaceOf(without, spaceId)!.pinned, toParentId, index, removed.item);
  return pinned ? updateSpace(without, spaceId, (s) => ({ ...s, pinned })) : lib;
}

export function addPinned(lib: Library, spaceId: string, parentId: string | null, tab: { url: string; title: string }): Library {
  const space = spaceOf(lib, spaceId);
  const pinned = space && insert(space.pinned, parentId, Infinity, { kind: 'tab', id: crypto.randomUUID(), url: tab.url, title: tab.title });
  return pinned ? updateSpace(lib, spaceId, (s) => ({ ...s, pinned })) : lib;
}
