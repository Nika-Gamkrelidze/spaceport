import { describe, expect, test } from 'vitest';
import { writeBookmarkCopy } from './bookmarks';
import { FakeBookmarks, type FakeBookmark } from '../../test/fakeBrowser';
import type { Item, PinnedTab, Space } from '../model';

let n = 0;
const tab = (url: string, title: string, customName?: string): PinnedTab => ({ kind: 'tab', id: `t${++n}`, url, title, ...(customName ? { customName } : {}) });
const folder = (name: string, children: Item[]): Item => ({ kind: 'folder', id: `f${++n}`, name, children });
const space = (name: string, pinned: Item[], today: PinnedTab[] = [], arcProfile = 'default'): Space => ({ id: `s${++n}`, name, arcProfile, pinned, today });

/** Shape of a bookmark subtree as nested [title, url | children]. */
const shape = (node: FakeBookmark | undefined): unknown =>
  node?.url !== undefined ? [node.title, node.url] : [node?.title, (node?.children ?? []).map(shape)];

describe('writeBookmarkCopy', () => {
  test('mirrors each space with nesting and custom names under Other bookmarks', async () => {
    const api = new FakeBookmarks();
    const s = space('Work', [
      tab('https://a.example', 'A page', 'Alpha'),
      folder('Tools', [tab('https://b.example', 'B'), folder('Deep', [tab('https://c.example', '')])]),
    ]);
    const summary = await writeBookmarkCopy(api, [s], {});
    expect(shape(api.find('Arc – Work'))).toEqual(['Arc – Work', [
      ['Alpha', 'https://a.example'],
      ['Tools', [['B', 'https://b.example'], ['Deep', [['https://c.example', 'https://c.example']]]]],
    ]]);
    expect(summary).toEqual({ foldersCreated: 3, bookmarksCreated: 3, skipped: [] });
  });

  test('today tabs go in "Today" and a split view becomes "Split View"', async () => {
    const api = new FakeBookmarks();
    const split: Item = { kind: 'split', id: 'sp', tabs: [tab('https://l.example', 'L'), tab('https://r.example', 'R')] };
    await writeBookmarkCopy(api, [space('S', [split], [tab('https://t.example', 'T')])], {});
    expect(shape(api.find('Arc – S'))).toEqual(['Arc – S', [
      ['Split View', [['L', 'https://l.example'], ['R', 'https://r.example']]],
      ['Today', [['T', 'https://t.example']]],
    ]]);
  });

  test('notes and unsupported URLs are reported, bookmark-only URLs are written', async () => {
    const api = new FakeBookmarks();
    const s = space('S', [
      { kind: 'note', id: 'n', title: 'My note', documentId: 'd' },
      tab('arc://boost/1', 'Boost'),
      tab('chrome://settings', 'Settings'),
    ]);
    const summary = await writeBookmarkCopy(api, [s], {});
    expect(shape(api.find('Arc – S'))).toEqual(['Arc – S', [['Settings', 'chrome://settings']]]);
    expect(summary.skipped).toEqual([
      { reason: 'note', title: 'My note' },
      { reason: 'unsupported URL', title: 'Boost' },
    ]);
  });

  test('re-import replaces folders with the same name at the top two levels only', async () => {
    const api = new FakeBookmarks();
    api.add('1', 'Arc – Work');
    const keep = api.add('2', 'Mine');
    api.add(keep, 'Arc – Work', undefined, 'nested-old');
    const deeper = api.add(api.add(keep, 'Sub'), 'Arc – Work', undefined, 'too-deep');
    await writeBookmarkCopy(api, [space('Work', [tab('https://a.example', 'A')])], {});
    await writeBookmarkCopy(api, [space('Work', [tab('https://a.example', 'A')])], {});
    const tree = JSON.stringify(await api.getTree());
    expect(tree.match(/Arc – Work/g)).toHaveLength(2); // the fresh copy plus the one three levels down
    expect(api.find('Arc – Work', '1')).toBeUndefined();
    expect(tree).not.toContain('nested-old');
    expect(tree).toContain(deeper);
    expect(api.find('Arc – Work')?.children).toHaveLength(1);
  });

  test('falls back to the second root child when there is no id 2', async () => {
    const api = new FakeBookmarks();
    api.add('0', 'Other', undefined, '9');
    api.root.children!.splice(1, 1);
    await writeBookmarkCopy(api, [space('S', [])], {});
    expect(api.root.children![1]!.children!.map((c) => c.title)).toEqual(['Arc – S']);
  });

  test('favorites of the imported profiles get one folder', async () => {
    const api = new FakeBookmarks();
    const favorites = { default: [tab('https://fav.example', 'Fav')], 'Profile 3': [tab('https://other.example', 'Other')] };
    const summary = await writeBookmarkCopy(api, [space('S', [])], favorites);
    expect(shape(api.find('Arc – Favorites'))).toEqual(['Arc – Favorites', [['Fav', 'https://fav.example']]]);
    expect(summary.foldersCreated).toBe(2);
  });

  test('no favorites folder when the imported profiles have none', async () => {
    const api = new FakeBookmarks();
    await writeBookmarkCopy(api, [space('S', [], [], 'Profile 9')], { default: [tab('https://fav.example', 'Fav')] });
    expect(api.find('Arc – Favorites')).toBeUndefined();
  });
});
