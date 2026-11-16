import type { ArcSetup, Space } from '../model';
import { validateLibrary } from './validate';

/** The subset of chrome.storage.local we use. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** A space as kept in the sidebar, with what it looked like when imported (to detect later edits). */
export interface StoredSpace { sourceId: string; space: Space; importedHash: string; importedAt: string }
export interface Library { version: 1; spaces: StoredSpace[]; favorites: ArcSetup['favorites'] }
export type ImportStatus = 'new' | 'replace' | 'conflict';
export type Decision = 'replace' | 'keep' | 'copy';

const KEY = 'library';

export const emptyLibrary = (): Library => ({ version: 1, spaces: [], favorites: {} });

/** FNV-1a over the space's JSON: cheap, stable fingerprint for "edited since import". */
export function spaceHash(space: Space): string {
  const text = JSON.stringify(space);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

const isEdited = (s: StoredSpace) => spaceHash(s.space) !== s.importedHash;

export function planImport(lib: Library, incoming: Space[]): { sourceId: string; name: string; status: ImportStatus }[] {
  return incoming.map((sp) => {
    const existing = lib.spaces.find((s) => s.sourceId === sp.id);
    const status: ImportStatus = !existing ? 'new' : isEdited(existing) ? 'conflict' : 'replace';
    return { sourceId: sp.id, name: sp.name, status };
  });
}

/** Returns a new library. Conflicts without a decision are kept: an edited space is never replaced silently. */
export function applyImport(lib: Library, incoming: Space[], decisions: Record<string, Decision>, now: Date): Library {
  const spaces = [...lib.spaces];
  const stored = (sp: Space, sourceId = sp.id): StoredSpace => ({ sourceId, space: sp, importedHash: spaceHash(sp), importedAt: now.toISOString() });

  for (const sp of incoming) {
    const i = spaces.findIndex((s) => s.sourceId === sp.id && !s.space.id.includes('#copy'));
    const existing = i >= 0 ? spaces[i] : undefined;
    const decision: Decision = !existing ? 'replace' : decisions[sp.id] ?? (isEdited(existing) ? 'keep' : 'replace');

    if (!existing) spaces.push(stored(sp));
    else if (decision === 'replace') spaces[i] = stored(sp);
    else if (decision === 'copy') {
      const n = spaces.filter((s) => s.sourceId === sp.id).length + 1;
      spaces.push(stored({ ...sp, id: `${sp.id}#copy${n}`, name: `${sp.name} (${n})` }, sp.id));
    }
  }
  return { ...lib, spaces };
}

export async function loadLibrary(storage: StorageArea): Promise<Library> {
  const raw = (await storage.get(KEY))[KEY];
  return raw === undefined ? emptyLibrary() : validateLibrary(raw) ?? emptyLibrary();
}

export async function saveLibrary(storage: StorageArea, lib: Library): Promise<void> {
  await storage.set({ [KEY]: lib });
}
