// In-memory stand-in for the chrome.tabs / tabGroups / storage.session subsets the sidebar uses (SidebarApi).
// Follows Chrome's observable behaviour: missing tabs reject, groups vanish when their last tab leaves.
import type { GroupColor } from '../src/import/colors';
import type { SidebarApi } from '../src/sidebar/actions';

export interface SideTab { id: number; windowId: number; url: string; pendingUrl?: string; active: boolean; groupId: number }
export interface SideGroup { id: number; windowId: number; title: string; color: GroupColor; collapsed: boolean }

export class FakeSidebar implements SidebarApi {
  tabsById = new Map<number, SideTab>();
  groupsById = new Map<number, SideGroup>();
  store: Record<string, unknown> = {};
  calls: string[] = [];
  private nextId = 1;

  private tab(id: number): SideTab {
    const t = this.tabsById.get(id);
    if (!t) throw new Error(`No tab with id: ${id}.`);
    return t;
  }
  private activate(t: SideTab) {
    for (const o of this.tabsById.values()) if (o.windowId === t.windowId) o.active = false;
    t.active = true;
  }

  tabs = {
    query: async (q: { windowId?: number; url?: string }) =>
      [...this.tabsById.values()]
        .filter((t) => (q.windowId === undefined || t.windowId === q.windowId) && (q.url === undefined || t.url === q.url))
        .map((t) => ({ ...t })),
    get: async (tabId: number) => ({ ...this.tab(tabId) }),
    create: async (p: { windowId: number; url: string; active: boolean }) => {
      this.calls.push('tabs.create');
      const t: SideTab = { id: this.nextId++, windowId: p.windowId, url: p.url, active: false, groupId: -1 };
      this.tabsById.set(t.id, t);
      if (p.active) this.activate(t);
      return { ...t };
    },
    update: async (tabId: number, p: { active?: boolean; url?: string }) => {
      this.calls.push('tabs.update');
      const t = this.tab(tabId);
      if (p.url !== undefined) t.url = p.url;
      if (p.active) this.activate(t);
      return { ...t };
    },
    group: async (p: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) => {
      this.calls.push('tabs.group');
      const tabs = p.tabIds.map((id) => this.tab(id));
      if (p.groupId !== undefined && !this.groupsById.has(p.groupId)) throw new Error(`No group with id: ${p.groupId}.`);
      const id = p.groupId ?? this.nextId++;
      const windowId = p.createProperties?.windowId ?? tabs[0]!.windowId;
      if (!this.groupsById.has(id)) this.groupsById.set(id, { id, windowId, title: '', color: 'grey', collapsed: false });
      tabs.forEach((t) => { t.groupId = id; });
      for (const g of this.groupsById.values()) if (!this.tabsIn(g.id).length) this.groupsById.delete(g.id);
      return id;
    },
    discard: async () => { this.calls.push('tabs.discard'); throw new Error('the sidebar must never discard tabs'); },
  };

  tabGroups = {
    query: async (q: { windowId?: number; title?: string }) =>
      [...this.groupsById.values()]
        .filter((g) => (q.windowId === undefined || g.windowId === q.windowId) && (q.title === undefined || g.title === q.title))
        .map((g) => ({ ...g })),
    update: async (groupId: number, p: { title?: string; color?: GroupColor; collapsed?: boolean }) => {
      this.calls.push('tabGroups.update');
      const g = this.groupsById.get(groupId);
      if (!g) throw new Error(`No group with id: ${groupId}.`);
      Object.assign(g, p);
      return { ...g };
    },
  };

  session = {
    get: async (key: string) => (key in this.store ? { [key]: structuredClone(this.store[key]) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(this.store, structuredClone(items)); },
  };

  /** Test setup: a tab (optionally in a new or existing group); returns its id. */
  addTab(windowId: number, url: string, groupId = -1): number {
    const t: SideTab = { id: this.nextId++, windowId, url, active: false, groupId };
    this.tabsById.set(t.id, t);
    return t.id;
  }
  /** Test setup: a group in this window holding one fresh tab; returns the group id. */
  addGroup(windowId: number, title: string, collapsed = false): number {
    const id = this.nextId++;
    this.groupsById.set(id, { id, windowId, title, color: 'blue', collapsed });
    this.addTab(windowId, 'https://filler.example/', id);
    return id;
  }
  close(tabId: number) { this.tabsById.delete(tabId); }

  tabsIn = (groupId: number) => [...this.tabsById.values()].filter((t) => t.groupId === groupId);
  group = (title: string, windowId?: number) =>
    [...this.groupsById.values()].find((g) => g.title === title && (windowId === undefined || g.windowId === windowId));
}
