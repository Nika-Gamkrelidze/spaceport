import type { Item, Space } from '../model';
import { nearestGroupColor, type GroupColor } from './colors';
import { classifyUrl } from './urls';

/** The chrome.tabs / tabGroups / windows subset folder groups need. Deliberately has no tabs.discard. */
export interface GroupsApi {
  windows: { create(opts: { focused?: boolean }): Promise<{ id?: number }> };
  tabs: {
    create(p: { windowId: number; url?: string; active: boolean }): Promise<{ id?: number }>;
    query(q: { groupId: number }): Promise<{ id?: number }[]>;
    group(p: { tabIds: number[]; createProperties: { windowId: number } }): Promise<number>;
    ungroup(tabIds: number[]): Promise<void>;
    remove(tabIds: number[]): Promise<void>;
  };
  tabGroups: {
    query(q: object): Promise<{ id: number; title?: string }[]>;
    update(groupId: number, p: { title: string; color: GroupColor; collapsed: boolean }): Promise<unknown>;
  };
}

export interface FolderGroupsOptions { /** Window to fill; a new window is opened when omitted. */ windowId?: number }
export interface FolderGroupsResult { groupsCreated: number; tabsOpened: number; replacedGroups: number; failed: string[] }

/** Title of the one space group the sidebar uses; space-group mode opens nothing at import time. */
export const spaceGroupTitle = (space: Space): string => space.name;

/** Folder titles ("Parent / Child") with the URLs of the pinned tabs directly inside them. */
function folderGroups(space: Space): [string, string[]][] {
  const out: [string, string[]][] = [];
  const walk = (title: string, items: Item[], top = false) => {
    const urls = items.flatMap((i) => (i.kind === 'tab' ? [i.url] : i.kind === 'split' ? i.tabs.map((t) => t.url) : []))
      .filter((u) => classifyUrl(u) === 'open');
    if (urls.length) out.push([title, urls]);
    for (const i of items) if (i.kind === 'folder') walk(top ? i.name : `${title} / ${i.name}`, i.children);
  };
  walk(space.name, space.pinned, true);
  return out;
}

/** Folder-group mode: one collapsed native tab group per folder of the space. Today tabs are not opened. */
export async function createFolderGroups(api: GroupsApi, space: Space, options: FolderGroupsOptions): Promise<FolderGroupsResult> {
  const result: FolderGroupsResult = { groupsCreated: 0, tabsOpened: 0, replacedGroups: 0, failed: [] };
  const groups = folderGroups(space);

  // A spare ungrouped tab keeps the window alive while groups are replaced; a new window comes with one.
  let windowId = options.windowId;
  if (windowId === undefined) windowId = (await api.windows.create({ focused: true })).id;
  else await api.tabs.create({ windowId, active: false });
  if (windowId === undefined) throw new Error('Could not open a window');

  const titles = new Set(groups.map(([t]) => t.toLowerCase()));
  for (const old of await api.tabGroups.query({})) {
    if (!titles.has((old.title ?? '').toLowerCase())) continue;
    const ids = (await api.tabs.query({ groupId: old.id })).flatMap((t) => (t.id === undefined ? [] : [t.id]));
    // Ungroup first: removing still-grouped tabs makes Chrome keep a saved group, which duplicates on re-import.
    await api.tabs.ungroup(ids);
    await api.tabs.remove(ids);
    result.replacedGroups++;
  }

  const color = nearestGroupColor(space.color);
  for (const [title, urls] of groups) {
    const tabIds: number[] = [];
    for (const url of urls) {
      // Never discard here: a tab discarded before it commits its URL is left as about:blank.
      const tab = await api.tabs.create({ windowId, url, active: false }).catch(() => undefined);
      if (tab?.id === undefined) result.failed.push(url);
      else tabIds.push(tab.id);
    }
    if (!tabIds.length) continue;
    const groupId = await api.tabs.group({ tabIds, createProperties: { windowId } });
    await api.tabGroups.update(groupId, { title, color, collapsed: true });
    result.groupsCreated++;
    result.tabsOpened += tabIds.length;
  }
  return result;
}
