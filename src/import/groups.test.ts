import { describe, expect, test } from 'vitest';
import { createFolderGroups, spaceGroupTitle } from './groups';
import { FakeBrowser } from '../../test/fakeBrowser';
import type { Item, PinnedTab, Space } from '../model';

let n = 0;
const tab = (url: string): PinnedTab => ({ kind: 'tab', id: `t${++n}`, url, title: url });
const folder = (name: string, children: Item[]): Item => ({ kind: 'folder', id: `f${++n}`, name, children });
const space = (name: string, pinned: Item[], today: PinnedTab[] = []): Space =>
  ({ id: `s${++n}`, name, arcProfile: 'default', color: { r: 40, g: 90, b: 230 }, pinned, today });

const groupUrls = (b: FakeBrowser) => Object.fromEntries(b.groups().map((g) => [g.title, b.tabsInGroup(g.id).map((t) => t.url)]));

describe('createFolderGroups', () => {
  test('one collapsed group per folder with pinned tabs, nested names flattened, loose tabs under the space name', async () => {
    const b = new FakeBrowser();
    const s = space('Work', [
      tab('https://loose.example'),
      folder('Tools', [tab('https://a.example'), folder('Deep', [tab('https://b.example')])]),
      folder('Only folders', [folder('Inner', [tab('https://c.example')])]),
    ]);
    const result = await createFolderGroups(b, s, {});
    expect(groupUrls(b)).toEqual({
      Work: ['https://loose.example'],
      Tools: ['https://a.example'],
      'Tools / Deep': ['https://b.example'],
      'Only folders / Inner': ['https://c.example'],
    });
    expect(b.groups().every((g) => g.color === 'blue' && g.collapsed)).toBe(true);
    expect(result).toEqual({ groupsCreated: 4, tabsOpened: 4, replacedGroups: 0, failed: [] });
  });

  test('tabs open inactive, never discarded, in a window that keeps a spare ungrouped tab', async () => {
    const b = new FakeBrowser();
    await createFolderGroups(b, space('S', [tab('https://a.example')]), {});
    const opened = [...b.tabsById.values()];
    expect(opened.filter((t) => t.url === 'https://a.example').every((t) => !t.active)).toBe(true);
    expect(opened.filter((t) => t.groupId === -1)).toHaveLength(1);
    expect(b.calls).not.toContain('tabs.discard');
  });

  test('uses the given window and adds a spare tab there first', async () => {
    const b = new FakeBrowser();
    const { id: windowId } = await b.windows.create();
    b.calls = [];
    await createFolderGroups(b, space('S', [tab('https://a.example')]), { windowId });
    expect(b.calls).not.toContain('windows.create');
    expect(b.calls[0]).toBe('tabs.create');
    expect(b.tabsInGroup(b.groups()[0]!.id)[0]!.windowId).toBe(windowId);
    expect([...b.tabsById.values()].filter((t) => t.windowId === windowId && t.groupId === -1)).toHaveLength(2);
  });

  test('only http(s) URLs become tabs, today tabs are not opened, empty groups are not made', async () => {
    const b = new FakeBrowser();
    const s = space('S', [tab('chrome://settings'), folder('F', [tab('javascript:void 0'), tab('https://ok.example')])], [tab('https://today.example')]);
    const result = await createFolderGroups(b, s, {});
    expect(groupUrls(b)).toEqual({ F: ['https://ok.example'] });
    expect(result.tabsOpened).toBe(1);
  });

  test('split view tabs open adjacent in their folder group', async () => {
    const b = new FakeBrowser();
    await createFolderGroups(b, space('S', [{ kind: 'split', id: 'sp', tabs: [tab('https://l.example'), tab('https://r.example')] }]), {});
    expect(groupUrls(b)).toEqual({ S: ['https://l.example', 'https://r.example'] });
  });

  test('re-import closes open groups with the same title (any case), ungrouping before removing', async () => {
    const b = new FakeBrowser();
    const old = await b.openGroup('tools', ['https://old.example']);
    await b.openGroup('Unrelated', ['https://keep.example']);
    const result = await createFolderGroups(b, space('S', [folder('Tools', [tab('https://new.example')])]), {});
    expect(groupUrls(b)).toEqual({ Unrelated: ['https://keep.example'], Tools: ['https://new.example'] });
    expect(b.savedGroups).toEqual([]);
    expect(b.windowIds.has(old.windowId)).toBe(false);
    expect(result.replacedGroups).toBe(1);
    expect(b.calls.indexOf('tabs.ungroup')).toBeLessThan(b.calls.indexOf('tabs.remove'));
  });

  test('a tab that fails to open is reported and the rest still open', async () => {
    const b = new FakeBrowser();
    b.failUrls.add('https://bad.example');
    const result = await createFolderGroups(b, space('S', [tab('https://bad.example'), tab('https://good.example')]), {});
    expect(result.failed).toEqual(['https://bad.example']);
    expect(groupUrls(b)).toEqual({ S: ['https://good.example'] });
  });
});

test('a folder named like its space still flattens its subfolders', async () => {
  const b = new FakeBrowser();
  await createFolderGroups(b, space('Work', [folder('Work', [folder('Sub', [tab('https://a.example')])])]), {});
  expect(groupUrls(b)).toEqual({ 'Work / Sub': ['https://a.example'] });
});

test('spaceGroupTitle is the space name', () => {
  expect(spaceGroupTitle(space('Personal', []))).toBe('Personal');
});
