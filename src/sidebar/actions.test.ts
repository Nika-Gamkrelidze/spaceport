import { describe, expect, test } from 'vitest';
import { backToPinned, openPinned, pinnedStates, switchSpace } from './actions';
import { FakeSidebar } from '../../test/fakeSidebar';

const W = 1;
const open = (b: FakeSidebar, pinnedId: string, url: string, spaceName = 'Work') =>
  openPinned(b, { pinnedId, url, spaceName, color: 'red', windowId: W });

describe('openPinned', () => {
  test('creates an active tab inside a new expanded space group named and colored for the space', async () => {
    const b = new FakeSidebar();
    const id = await open(b, 'p1', 'https://a.example/');
    const tab = b.tabsById.get(id)!;
    expect(tab).toMatchObject({ url: 'https://a.example/', active: true, windowId: W });
    expect(b.groupsById.get(tab.groupId)).toMatchObject({ title: 'Work', color: 'red', collapsed: false, windowId: W });
    expect(b.calls).not.toContain('tabs.discard');
  });

  test('reuses the existing space group in this window, not one with the same title elsewhere', async () => {
    const b = new FakeSidebar();
    b.addGroup(2, 'Work');
    const g = b.addGroup(W, 'Work', true);
    const id = await open(b, 'p1', 'https://a.example/');
    expect(b.tabsById.get(id)!.groupId).toBe(g);
    expect(b.groupsById.size).toBe(2);
  });

  test('activates the tracked tab instead of opening another', async () => {
    const b = new FakeSidebar();
    const first = await open(b, 'p1', 'https://a.example/');
    b.addTab(W, 'https://other.example/');
    await b.tabs.update(b.addTab(W, 'https://x.example/'), { active: true });
    expect(await open(b, 'p1', 'https://a.example/')).toBe(first);
    expect(b.tabsById.get(first)!.active).toBe(true);
    expect(b.calls.filter((c) => c === 'tabs.create')).toHaveLength(1);
  });

  test('a closed tracked tab is reopened', async () => {
    const b = new FakeSidebar();
    const first = await open(b, 'p1', 'https://a.example/');
    b.close(first);
    const second = await open(b, 'p1', 'https://a.example/');
    expect(second).not.toBe(first);
    expect(b.tabsById.get(second)!.url).toBe('https://a.example/');
  });

  test('adopts an untracked tab in this window showing the URL, ignoring trailing slash and hash', async () => {
    const b = new FakeSidebar();
    b.addTab(2, 'https://a.example/docs');
    const existing = b.addTab(W, 'https://a.example/docs/#section');
    expect(await open(b, 'p1', 'https://a.example/docs')).toBe(existing);
    expect(b.tabsById.get(existing)!.active).toBe(true);
    expect(b.calls).not.toContain('tabs.create');
    expect(b.store.pinnedTabs).toEqual({ p1: { tabId: existing, url: 'https://a.example/docs' } });
  });

  test('records the tracked tab in session storage', async () => {
    const b = new FakeSidebar();
    const id = await open(b, 'p1', 'https://a.example/');
    expect(b.store.pinnedTabs).toEqual({ p1: { tabId: id, url: 'https://a.example/' } });
  });
});

describe('switchSpace', () => {
  test('collapses other space groups in the window, expands the active one, leaves the rest alone', async () => {
    const b = new FakeSidebar();
    b.addGroup(W, 'Work', true);
    b.addGroup(W, 'Home');
    b.addGroup(W, 'Research');
    b.addGroup(W, 'Not a space');
    b.addGroup(2, 'Home');
    await switchSpace(b, { windowId: W, active: 'Work', all: ['Work', 'Home', 'Research'] });
    const collapsed = (t: string, w = W) => b.group(t, w)!.collapsed;
    expect([collapsed('Work'), collapsed('Home'), collapsed('Research'), collapsed('Not a space'), collapsed('Home', 2)])
      .toEqual([false, true, true, false, false]);
  });

  test('works when the active space has no group yet', async () => {
    const b = new FakeSidebar();
    b.addGroup(W, 'Home');
    await switchSpace(b, { windowId: W, active: 'Work', all: ['Work', 'Home'] });
    expect(b.group('Home')!.collapsed).toBe(true);
  });
});

describe('pinnedStates', () => {
  test('closed when untracked or the tab is gone, open on the pinned page (or loading it), away after navigating', async () => {
    const b = new FakeSidebar();
    const gone = await open(b, 'gone', 'https://g.example/');
    await open(b, 'open', 'https://o.example/');
    const loading = await open(b, 'loading', 'https://l.example/');
    b.tabsById.get(loading)!.url = 'about:blank';
    b.tabsById.get(loading)!.pendingUrl = 'https://l.example/#top';
    const away = await open(b, 'away', 'https://a.example/');
    b.tabsById.get(away)!.url = 'https://a.example/elsewhere';
    b.close(gone);
    const states = await pinnedStates(b, [
      { pinnedId: 'never', url: 'https://n.example/' },
      { pinnedId: 'gone', url: 'https://g.example/' },
      { pinnedId: 'open', url: 'https://o.example' },
      { pinnedId: 'loading', url: 'https://l.example/' },
      { pinnedId: 'away', url: 'https://a.example/' },
    ]);
    expect(states).toEqual({ never: 'closed', gone: 'closed', open: 'open', loading: 'open', away: 'away' });
    expect(Object.keys(b.store.pinnedTabs as object).sort()).toEqual(['away', 'loading', 'open']);
  });
});

describe('backToPinned', () => {
  test('navigates the tracked tab back to the pinned URL and activates it', async () => {
    const b = new FakeSidebar();
    const id = await open(b, 'p1', 'https://a.example/');
    b.tabsById.get(id)!.url = 'https://a.example/elsewhere';
    await b.tabs.update(b.addTab(W, 'https://x.example/'), { active: true });
    await backToPinned(b, 'p1', 'https://a.example/');
    expect(b.tabsById.get(id)).toMatchObject({ url: 'https://a.example/', active: true });
  });

  test('does nothing when the pinned tab is not tracked', async () => {
    const b = new FakeSidebar();
    await backToPinned(b, 'p1', 'https://a.example/');
    expect(b.calls).toEqual([]);
  });
});
