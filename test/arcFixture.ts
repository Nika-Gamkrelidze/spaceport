// Builds made-up Arc sidebar files shaped like the real StorableSidebar.json. Never use real data in tests.

type Profile = { default: true } | { custom: { _0: { directoryBasename: string; machineID: string } } };

export const defaultProfile: Profile = { default: true };
export const customProfile = (dir: string): Profile => ({ custom: { _0: { directoryBasename: dir, machineID: 'MACHINE' } } });

export class ArcFixture {
  private items: [string, object][] = [];
  private spaces: [string, object][] = [];
  private topApps: (object | string)[] = [];
  private n = 0;

  private id(prefix: string) { return `${prefix}-${++this.n}`; }

  private add(item: Record<string, unknown>) {
    this.items.push([item.id as string, item]);
    return item.id as string;
  }

  tab(parentID: string, url: string, savedTitle: string, title: string | null = null) {
    return this.add({ id: this.id('tab'), parentID, childrenIds: [], title, data: { tab: { savedURL: url, savedTitle } } });
  }

  folder(parentID: string, title: string, children: (id: string) => void = () => {}) {
    const id = this.add({ id: this.id('folder'), parentID, childrenIds: [], title, data: { list: {} } });
    this.withChildren(id, children);
    return id;
  }

  split(parentID: string, children: (id: string) => void) {
    const id = this.add({ id: this.id('split'), parentID, childrenIds: [], title: null, data: { splitView: { layoutOrientation: 'horizontal' } } });
    this.withChildren(id, children);
    return id;
  }

  raw(parentID: string, data: object, title: string | null = null) {
    return this.add({ id: this.id('raw'), parentID, childrenIds: [], title, data });
  }

  /** Adds a space; `pinned` and `today` receive their container ids. */
  space(title: string, opts: { profile?: Profile; color?: [number, number, number]; pinned?: (id: string) => void; today?: (id: string) => void } = {}) {
    const sid = this.id('space');
    const pinned = this.add({ id: this.id('pinned'), childrenIds: [], title: null, data: { itemContainer: { containerType: { spaceItems: { _0: sid } } } } });
    const today = this.add({ id: this.id('today'), childrenIds: [], title: null, data: { itemContainer: { containerType: { spaceItems: { _0: sid } } } } });
    this.withChildren(pinned, opts.pinned);
    this.withChildren(today, opts.today);
    const [red, green, blue] = opts.color ?? [0.5, 0.5, 0.5];
    this.spaces.push([sid, {
      id: sid, title, profile: opts.profile ?? defaultProfile,
      containerIDs: ['pinned', pinned, 'unpinned', today],
      customInfo: { windowTheme: { primaryColorPalette: { midTone: { red, green, blue, alpha: 1, colorSpace: 'extendedSRGB' } } } },
    }]);
    return sid;
  }

  favorites(profile: Profile, children: (id: string) => void) {
    const id = this.add({ id: this.id('fav'), childrenIds: [], title: null, data: { itemContainer: { containerType: { topApps: { _0: profile } } } } });
    this.topApps.push(profile, id);
    this.withChildren(id, children);
    return id;
  }

  /** Point a parent at an arbitrary list of child ids (for broken/cyclic files). */
  setChildren(id: string, childrenIds: string[]) {
    (this.items.find(([k]) => k === id)![1] as { childrenIds: string[] }).childrenIds = childrenIds;
  }

  private withChildren(parent: string, build?: (id: string) => void) {
    if (!build) return;
    const before = new Set(this.items.map(([k]) => k));
    build(parent);
    const direct = this.items.filter(([k, v]) => !before.has(k) && (v as { parentID?: string }).parentID === parent).map(([k]) => k);
    this.setChildren(parent, direct);
  }

  json() {
    return JSON.stringify({
      __synthetic: true,
      version: 1,
      sidebarSyncState: {},
      firebaseSyncState: {},
      sidebar: {
        containers: [
          { global: {} },
          { spaces: this.spaces.flat(), items: this.items.flat(), topAppsContainerIDs: this.topApps },
        ],
      },
    });
  }
}
