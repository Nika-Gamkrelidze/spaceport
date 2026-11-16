import { browser } from 'wxt/browser';
import type { BookmarksApi } from '../import/bookmarks';
import type { GroupsApi } from '../import/groups';
import type { ImportDeps } from '../import/run';
import type { SidebarApi } from '../sidebar/actions';
import type { StorageArea } from '../store/library';

// Our API interfaces are narrow subsets of the browser's; the casts only drop fields we don't use.
export const storage: StorageArea = browser.storage.local as unknown as StorageArea;

export const importDeps = (): ImportDeps => ({
  bookmarks: browser.bookmarks as unknown as BookmarksApi,
  groups: { tabs: browser.tabs, tabGroups: browser.tabGroups, windows: browser.windows } as unknown as GroupsApi,
  storage,
  now: () => new Date(),
});

export const sidebarApi = (): SidebarApi => ({
  tabs: browser.tabs as unknown as SidebarApi['tabs'],
  tabGroups: browser.tabGroups as unknown as SidebarApi['tabGroups'],
  session: browser.storage.session as unknown as StorageArea,
});

export const openImportPage = () => browser.tabs.create({ url: browser.runtime.getURL('/import.html') });

/** Lets the person save text as a file without the downloads permission. */
export function saveTextFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const groupColorVar = (c: string) => `var(--g-${c})`;
