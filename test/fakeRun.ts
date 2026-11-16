import type { StorageArea } from '../src/store/library';

/** In-memory chrome.storage.local subset; values are cloned like Chrome's structured storage. */
export class FakeStorage implements StorageArea {
  data: Record<string, unknown> = {};
  async get(key: string) { return key in this.data ? { [key]: structuredClone(this.data[key]) } : {}; }
  async set(items: Record<string, unknown>) { Object.assign(this.data, structuredClone(items)); }
}
