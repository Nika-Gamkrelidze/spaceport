import { describe, expect, test } from 'vitest';
import { addPinned, moveItem, removeItem, removeSpace, renameItem, renameSpace, restore } from './edit';
import type { Library } from './library';
import type { Folder, Item, PinnedTab, Space } from '../model';

const tab = (id: string, title = id, customName?: string): PinnedTab =>
  ({ kind: 'tab', id, url: `https://${id}.example`, title, ...(customName ? { customName } : {}) });

// s1.pinned: [t1, f1[t2, f2[t3]], split[st1, st2], n1]; s1.today: [d1]
const lib = (): Library => {
  const s1: Space = {
    id: 's1', name: 'Work', arcProfile: 'default',
    pinned: [
      tab('t1', 'Title 1', 'Old name'),
      { kind: 'folder', id: 'f1', name: 'Folder', children: [tab('t2'), { kind: 'folder', id: 'f2', name: 'Inner', children: [tab('t3')] }] },
      { kind: 'split', id: 'sp', tabs: [tab('st1'), tab('st2')] },
      { kind: 'note', id: 'n1', title: 'Note', documentId: 'doc' },
    ],
    today: [tab('d1')],
  };
  const s2: Space = { id: 's2', name: 'Home', arcProfile: 'default', pinned: [], today: [] };
  return {
    version: 1, favorites: {},
    spaces: [s1, s2].map((space) => ({ sourceId: space.id, space, importedHash: 'h', importedAt: 'x' })),
  };
};

const sp = (l: Library, id = 's1') => l.spaces.find((s) => s.space.id === id)!.space;
const find = (items: Item[], id: string): Item | undefined => {
  for (const it of items) {
    if (it.id === id) return it;
    const kids = it.kind === 'folder' ? it.children : it.kind === 'split' ? it.tabs : [];
    const hit = find(kids, id);
    if (hit) return hit;
  }
  return undefined;
};
const ids = (items: Item[]) => items.map((i) => i.id);
const folder = (l: Library, id: string) => find(sp(l).pinned, id) as Folder;

describe('renaming', () => {
  test('a folder gets the new name, trimmed', () => {
    expect(folder(renameItem(lib(), 's1', 'f2', '  Deep  '), 'f2').name).toBe('Deep');
  });

  test('a pinned tab gets a custom name', () => {
    expect((find(sp(renameItem(lib(), 's1', 't3', 'Mine')).pinned, 't3') as PinnedTab).customName).toBe('Mine');
  });

  test('a tab inside a split view can be renamed', () => {
    expect((find(sp(renameItem(lib(), 's1', 'st2', 'Right')).pinned, 'st2') as PinnedTab).customName).toBe('Right');
  });

  test('an empty name or one equal to the title clears the custom name', () => {
    expect(find(sp(renameItem(lib(), 's1', 't1', '  ')).pinned, 't1')).not.toHaveProperty('customName');
    expect(find(sp(renameItem(lib(), 's1', 't1', ' Title 1 ')).pinned, 't1')).not.toHaveProperty('customName');
  });

  test('a note gets a new title', () => {
    expect((find(sp(renameItem(lib(), 's1', 'n1', 'Plans')).pinned, 'n1') as { title: string }).title).toBe('Plans');
  });

  test('a today tab can be renamed', () => {
    expect(sp(renameItem(lib(), 's1', 'd1', 'Today one')).today[0]?.customName).toBe('Today one');
  });

  test('does not mutate the input; unknown ids leave it unchanged', () => {
    const before = lib();
    renameItem(before, 's1', 'f2', 'Deep');
    expect(before).toEqual(lib());
    expect(renameItem(before, 's1', 'nope', 'x')).toEqual(lib());
    expect(renameItem(before, 'nope', 'f2', 'x')).toEqual(lib());
  });

  test('a space gets the new name, trimmed; empty keeps the old one', () => {
    const before = lib();
    expect(sp(renameSpace(before, 's2', ' Family '), 's2').name).toBe('Family');
    expect(sp(renameSpace(before, 's2', '   '), 's2').name).toBe('Home');
    expect(renameSpace(before, 'nope', 'x')).toEqual(lib());
    expect(before).toEqual(lib());
  });
});

describe('removing and restoring', () => {
  test('removing a nested item records where it was', () => {
    const before = lib();
    const { lib: after, removed } = removeItem(before, 's1', 't3');
    expect(find(sp(after).pinned, 't3')).toBeUndefined();
    expect(removed).toEqual({ kind: 'item', spaceId: 's1', parentId: 'f2', index: 0, from: 'pinned', item: tab('t3') });
    expect(before).toEqual(lib());
  });

  test('removing a today tab records that it came from today', () => {
    const { lib: after, removed } = removeItem(lib(), 's1', 'd1');
    expect(sp(after).today).toEqual([]);
    expect(removed).toMatchObject({ parentId: null, index: 0, from: 'today' });
  });

  test('restore puts items back exactly where they were', () => {
    for (const id of ['t1', 'f2', 't3', 'n1', 'd1']) {
      const { lib: after, removed } = removeItem(lib(), 's1', id);
      expect(restore(after, removed!)).toEqual(lib());
    }
  });

  test('restore lands at the top level when the parent folder is gone', () => {
    const { lib: a, removed } = removeItem(lib(), 's1', 't3');
    const { lib: b } = removeItem(a, 's1', 'f1');
    expect(ids(sp(restore(b, removed!)).pinned)).toEqual(['t1', 'sp', 'n1', 't3']);
  });

  test('restore appends when the old index is past the end', () => {
    const { lib: a, removed } = removeItem(lib(), 's1', 'n1');
    const { lib: b } = removeItem(a, 's1', 'sp');
    expect(ids(sp(restore(b, removed!)).pinned)).toEqual(['t1', 'f1', 'n1']);
  });

  test('restore does not mutate its input', () => {
    const { lib: after, removed } = removeItem(lib(), 's1', 't3');
    const snapshot = structuredClone(after);
    restore(after, removed!);
    expect(after).toEqual(snapshot);
  });

  test('unknown ids leave the library unchanged', () => {
    expect(removeItem(lib(), 's1', 'nope')).toEqual({ lib: lib(), removed: null });
    expect(removeItem(lib(), 'nope', 't1')).toEqual({ lib: lib(), removed: null });
    expect(removeSpace(lib(), 'nope')).toEqual({ lib: lib(), removed: null });
  });

  test('a removed space comes back at the same position', () => {
    const before = lib();
    const { lib: after, removed } = removeSpace(before, 's1');
    expect(after.spaces.map((s) => s.space.id)).toEqual(['s2']);
    expect(removed).toMatchObject({ kind: 'space', index: 0 });
    expect(before).toEqual(lib());
    expect(restore(after, removed!)).toEqual(lib());
  });
});

describe('moving', () => {
  test('a top-level tab moves into a nested folder at an index', () => {
    const before = lib();
    const after = moveItem(before, 's1', 't1', 'f2', 0);
    expect(ids(folder(after, 'f2').children)).toEqual(['t1', 't3']);
    expect(ids(sp(after).pinned)).toEqual(['f1', 'sp', 'n1']);
    expect(before).toEqual(lib());
  });

  test('reorders within the top level', () => {
    expect(ids(sp(moveItem(lib(), 's1', 'n1', null, 0)).pinned)).toEqual(['n1', 't1', 'f1', 'sp']);
  });

  test('the index is clamped', () => {
    expect(ids(sp(moveItem(lib(), 's1', 't3', null, 99)).pinned)).toEqual(['t1', 'f1', 'sp', 'n1', 't3']);
    expect(ids(sp(moveItem(lib(), 's1', 't3', null, -5)).pinned)).toEqual(['t3', 't1', 'f1', 'sp', 'n1']);
  });

  test('a folder cannot move into itself or its descendants', () => {
    expect(moveItem(lib(), 's1', 'f1', 'f1', 0)).toEqual(lib());
    expect(moveItem(lib(), 's1', 'f1', 'f2', 0)).toEqual(lib());
  });

  test('a today tab moved into pinned becomes pinned', () => {
    const after = moveItem(lib(), 's1', 'd1', 'f1', 1);
    expect(sp(after).today).toEqual([]);
    expect(ids(folder(after, 'f1').children)).toEqual(['t2', 'd1', 'f2']);
  });

  test('unknown ids leave the library unchanged', () => {
    expect(moveItem(lib(), 's1', 'nope', null, 0)).toEqual(lib());
    expect(moveItem(lib(), 's1', 't1', 'nope', 0)).toEqual(lib());
    expect(moveItem(lib(), 's1', 't1', 'n1', 0)).toEqual(lib());
    expect(moveItem(lib(), 'nope', 't1', null, 0)).toEqual(lib());
  });
});

describe('adding a pinned tab', () => {
  test('appends a new tab with a fresh unique id', () => {
    const before = lib();
    const a = addPinned(before, 's1', null, { url: 'https://new.example', title: 'New' });
    const b = addPinned(a, 's1', null, { url: 'https://new.example', title: 'New' });
    const [x, y] = sp(b).pinned.slice(-2);
    expect(x).toMatchObject({ kind: 'tab', url: 'https://new.example', title: 'New' });
    expect(x?.id).toBeTruthy();
    expect(x?.id).not.toBe(y?.id);
    expect(ids(sp(b).pinned).slice(0, 4)).toEqual(['t1', 'f1', 'sp', 'n1']);
    expect(before).toEqual(lib());
  });

  test('appends inside a folder', () => {
    const after = addPinned(lib(), 's1', 'f2', { url: 'https://new.example', title: 'New' });
    expect(folder(after, 'f2').children.map((c) => c.kind === 'tab' && c.title)).toEqual(['t3', 'New']);
  });

  test('unknown ids leave the library unchanged', () => {
    expect(addPinned(lib(), 's1', 'nope', { url: 'u', title: 't' })).toEqual(lib());
    expect(addPinned(lib(), 'nope', null, { url: 'u', title: 't' })).toEqual(lib());
  });
});
