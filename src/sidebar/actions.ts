import type { GroupColor } from '../import/colors';
import type { StorageArea } from '../store/library';

/** The chrome.tabs / tabGroups subset the sidebar needs, plus session storage for pinned-tab tracking. */
export interface SidebarApi {
  tabs: {
    query(q: { windowId?: number; url?: string }): Promise<{ id?: number; url?: string; pendingUrl?: string; groupId: number; windowId: number }[]>;
    get(tabId: number): Promise<{ id?: number; url?: string; pendingUrl?: string; groupId: number; windowId: number }>;
    create(p: { windowId: number; url: string; active: boolean }): Promise<{ id?: number }>;
    update(tabId: number, p: { active?: boolean; url?: string }): Promise<unknown>;
    group(p: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }): Promise<number>;
  };
  tabGroups: {
    query(q: { windowId?: number; title?: string }): Promise<{ id: number; title?: string; collapsed: boolean; windowId: number }[]>;
    update(groupId: number, p: { title?: string; color?: GroupColor; collapsed?: boolean }): Promise<unknown>;
  };
  session: StorageArea;
}

export type PinnedState = 'closed' | 'open' | 'away';

export interface OpenPinned { pinnedId: string; url: string; spaceName: string; color: GroupColor; windowId: number }

type Tracked = Record<string, { tabId: number; url: string }>;
const KEY = 'pinnedTabs';

/** Same page for pinned-tab purposes: ignores the #hash and a trailing slash. */
const samePage = (a: string | undefined, b: string): boolean => {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
  return a !== undefined && norm(a) === norm(b);
};
const tracked = async (api: SidebarApi): Promise<Tracked> => ((await api.session.get(KEY))[KEY] as Tracked | undefined) ?? {};
const liveTab = (api: SidebarApi, tabId: number) => api.tabs.get(tabId).catch(() => undefined);

/** Switch to the pinned tab's open tab, adopt a matching one, or open it in the space group. Never discards. */
export async function openPinned(api: SidebarApi, o: OpenPinned): Promise<number> {
  const map = await tracked(api);
  const known = map[o.pinnedId];
  if (known && (await liveTab(api, known.tabId))) {
    await api.tabs.update(known.tabId, { active: true });
    return known.tabId;
  }
  let tabId = (await api.tabs.query({ windowId: o.windowId })).find((t) => samePage(t.url, o.url))?.id;
  if (tabId !== undefined) await api.tabs.update(tabId, { active: true });
  else {
    const id = (await api.tabs.create({ windowId: o.windowId, url: o.url, active: true })).id;
    if (id === undefined) throw new Error('Could not open the pinned tab');
    tabId = id;
    const group = (await api.tabGroups.query({ windowId: o.windowId, title: o.spaceName }))
      .find((g) => g.title === o.spaceName && g.windowId === o.windowId);
    if (group) await api.tabs.group({ tabIds: [tabId], groupId: group.id });
    else {
      const groupId = await api.tabs.group({ tabIds: [tabId], createProperties: { windowId: o.windowId } });
      await api.tabGroups.update(groupId, { title: o.spaceName, color: o.color, collapsed: false });
    }
  }
  map[o.pinnedId] = { tabId, url: o.url };
  await api.session.set({ [KEY]: map });
  return tabId;
}
/** Collapse the other space groups in the window and expand the active one; non-space groups are untouched. */
export async function switchSpace(api: SidebarApi, o: { windowId: number; active: string; all: string[] }): Promise<void> {
  for (const g of await api.tabGroups.query({ windowId: o.windowId })) {
    if (g.windowId !== o.windowId || g.title === undefined || !o.all.includes(g.title)) continue;
    const collapsed = g.title !== o.active;
    if (g.collapsed !== collapsed) await api.tabGroups.update(g.id, { collapsed });
  }
}
/** Whether each pinned tab is closed, open on its page, or navigated away; forgets tabs that were closed. */
export async function pinnedStates(api: SidebarApi, pinned: { pinnedId: string; url: string }[]): Promise<Record<string, PinnedState>> {
  const map = await tracked(api);
  const states: Record<string, PinnedState> = {};
  let changed = false;
  for (const p of pinned) {
    const known = map[p.pinnedId];
    const tab = known && (await liveTab(api, known.tabId));
    if (known && !tab) { delete map[p.pinnedId]; changed = true; }
    states[p.pinnedId] = !tab ? 'closed' : samePage(tab.url, p.url) || samePage(tab.pendingUrl, p.url) ? 'open' : 'away';
  }
  if (changed) await api.session.set({ [KEY]: map });
  return states;
}

/** "Back to pinned page": return the tracked tab to the pinned URL and switch to it. */
export async function backToPinned(api: SidebarApi, pinnedId: string, url: string): Promise<void> {
  const known = (await tracked(api))[pinnedId];
  if (known) await api.tabs.update(known.tabId, { url, active: true });
}
