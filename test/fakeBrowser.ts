// In-memory stand-ins for the chrome.bookmarks / tabs / tabGroups / windows subsets import uses.
// They follow Chrome's observable behaviour closely enough to catch ordering bugs; never mock internals instead.

export interface FakeBookmark { id: string; parentId?: string; title: string; url?: string; children?: FakeBookmark[] }

export class FakeBookmarks {
  private nodes = new Map<string, FakeBookmark>();
  private next = 100;
  readonly root: FakeBookmark;

  constructor() {
    this.root = { id: '0', title: '', children: [] };
    this.nodes.set('0', this.root);
    this.add('0', 'Bookmarks bar', undefined, '1');
    this.add('0', 'Other bookmarks', undefined, '2');
  }

  /** Test setup helper; returns the new id. */
  add(parentId: string, title: string, url?: string, id = String(this.next++)): string {
    const parent = this.nodes.get(parentId);
    if (!parent?.children) throw new Error(`Can't find parent bookmark id ${parentId}.`);
    const node: FakeBookmark = { id, parentId, title, ...(url === undefined ? { children: [] } : { url }) };
    parent.children.push(node);
    this.nodes.set(id, node);
    return id;
  }

  async getTree(): Promise<FakeBookmark[]> { return [structuredClone(this.root)]; }

  async create(b: { parentId?: string; title?: string; url?: string }): Promise<FakeBookmark> {
    const id = this.add(b.parentId ?? '2', b.title ?? '', b.url);
    return structuredClone(this.nodes.get(id)!);
  }

  async removeTree(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Can't find bookmark for id.`);
    if (!node.parentId || node.parentId === '0') throw new Error("Can't modify the root bookmark folders.");
    const parent = this.nodes.get(node.parentId)!;
    parent.children = parent.children!.filter((c) => c.id !== id);
    const drop = (n: FakeBookmark) => { this.nodes.delete(n.id); n.children?.forEach(drop); };
    drop(node);
  }

  /** Child of `parentId` with this title, for assertions. */
  find(title: string, parentId = '2'): FakeBookmark | undefined {
    return this.nodes.get(parentId)?.children?.find((c) => c.title === title);
  }
}

export interface FakeTab { id: number; windowId: number; url: string; active: boolean; groupId: number }
export interface FakeGroup { id: number; windowId: number; title: string; color: string; collapsed: boolean }

export class FakeBrowser {
  readonly bookmarks = new FakeBookmarks();
  tabsById = new Map<number, FakeTab>();
  groupsById = new Map<number, FakeGroup>();
  windowIds = new Set<number>();
  /** Groups Chrome kept as saved groups because their tabs were closed while still grouped. */
  savedGroups: FakeGroup[] = [];
  /** URLs whose tabs.create rejects, to simulate failures. */
  failUrls = new Set<string>();
  calls: string[] = [];
  private nextId = 1;

  private tabsIn = (windowId: number) => [...this.tabsById.values()].filter((t) => t.windowId === windowId);
  private dropEmptyGroups() {
    for (const g of this.groupsById.values()) {
      if (![...this.tabsById.values()].some((t) => t.groupId === g.id)) this.groupsById.delete(g.id);
    }
  }
  private newTab(windowId: number, url = 'chrome://newtab/', active = true): FakeTab {
    const tab = { id: this.nextId++, windowId, url, active, groupId: -1 };
    this.tabsById.set(tab.id, tab);
    return tab;
  }

  windows = {
    create: async (_opts: { focused?: boolean } = {}) => {
      this.calls.push('windows.create');
      const id = this.nextId++;
      this.windowIds.add(id);
      return { id, tabs: [{ ...this.newTab(id) }] };
    },
  };

  tabs = {
    create: async (p: { windowId?: number; url?: string; active?: boolean }) => {
      this.calls.push('tabs.create');
      if (p.windowId === undefined || !this.windowIds.has(p.windowId)) throw new Error(`No window with id: ${p.windowId}.`);
      if (p.url && this.failUrls.has(p.url)) throw new Error('Cannot create tab');
      return { ...this.newTab(p.windowId, p.url, p.active ?? true) };
    },
    query: async (q: { groupId?: number; windowId?: number }) =>
      [...this.tabsById.values()]
        .filter((t) => (q.groupId === undefined || t.groupId === q.groupId) && (q.windowId === undefined || t.windowId === q.windowId))
        .map((t) => ({ ...t })),
    group: async (p: { tabIds: number | number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
      this.calls.push('tabs.group');
      const ids = ([] as number[]).concat(p.tabIds);
      const tabs = ids.map((id) => { const t = this.tabsById.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); return t; });
      const windowId = p.createProperties?.windowId ?? tabs[0]!.windowId;
      if (tabs.some((t) => t.windowId !== windowId)) throw new Error('Tabs must be in the same window');
      const id = p.groupId ?? this.nextId++;
      if (!this.groupsById.has(id)) this.groupsById.set(id, { id, windowId, title: '', color: 'grey', collapsed: false });
      tabs.forEach((t) => { t.groupId = id; });
      this.dropEmptyGroups();
      return id;
    },
    ungroup: async (tabIds: number | number[]) => {
      this.calls.push('tabs.ungroup');
      for (const id of ([] as number[]).concat(tabIds)) { const t = this.tabsById.get(id); if (t) t.groupId = -1; }
      this.dropEmptyGroups();
    },
    remove: async (tabIds: number | number[]) => {
      this.calls.push('tabs.remove');
      for (const id of ([] as number[]).concat(tabIds)) {
        const t = this.tabsById.get(id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        this.tabsById.delete(id);
        const g = this.groupsById.get(t.groupId);
        if (g && ![...this.tabsById.values()].some((o) => o.groupId === g.id) && !this.savedGroups.includes(g)) this.savedGroups.push(g);
        if (this.tabsIn(t.windowId).length === 0) this.windowIds.delete(t.windowId);
      }
      this.dropEmptyGroups();
    },
    discard: async (_tabId?: number) => { this.calls.push('tabs.discard'); throw new Error('import must never discard tabs'); },
  };

  tabGroups = {
    query: async (_q: object = {}) => [...this.groupsById.values()].map((g) => ({ ...g })),
    update: async (groupId: number, p: { title?: string; color?: string; collapsed?: boolean }) => {
      const g = this.groupsById.get(groupId);
      if (!g) throw new Error(`No group with id: ${groupId}.`);
      Object.assign(g, p);
      return { ...g };
    },
  };

  /** Test setup helper: an open window holding one group with these URLs. */
  async openGroup(title: string, urls: string[]): Promise<{ windowId: number; groupId: number }> {
    const w = await this.windows.create();
    const tabIds = urls.map((u) => this.newTab(w.id, u).id);
    await this.tabs.remove(w.tabs[0]!.id).catch(() => {});
    const groupId = await this.tabs.group({ tabIds, createProperties: { windowId: w.id } });
    this.groupsById.get(groupId)!.title = title;
    this.calls = [];
    return { windowId: w.id, groupId };
  }

  groups = () => [...this.groupsById.values()];
  tabsInGroup = (groupId: number) => [...this.tabsById.values()].filter((t) => t.groupId === groupId);
}
