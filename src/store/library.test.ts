import { describe, expect, test } from 'vitest';
import { applyImport, emptyLibrary, loadLibrary, planImport, saveLibrary, spaceHash, type StorageArea } from './library';
import type { Space } from '../model';

const space = (id: string, name: string, url = 'https://a.example'): Space => ({
  id, name, arcProfile: 'default', today: [],
  pinned: [{ kind: 'tab', id: id + '-t', url, title: 'A' }],
});

const memoryStorage = (): StorageArea & { data: Record<string, unknown> } => {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key: string) { return key in data ? { [key]: data[key] } : {}; },
    async set(items: Record<string, unknown>) { Object.assign(data, items); },
  };
};

const NOW = new Date('2026-11-20T10:00:00Z');

describe('planning an import', () => {
  test('a space never imported before is new', () => {
    expect(planImport(emptyLibrary(), [space('s1', 'Work')])).toEqual([{ sourceId: 's1', name: 'Work', status: 'new' }]);
  });

  test('re-importing an unedited space replaces it without asking', () => {
    const lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    expect(planImport(lib, [space('s1', 'Work', 'https://b.example')])[0]?.status).toBe('replace');
  });

  test('re-importing a space edited since its import is a conflict', () => {
    const lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    lib.spaces[0]!.space.name = 'Work (renamed in sidebar)';
    expect(planImport(lib, [space('s1', 'Work')])[0]?.status).toBe('conflict');
  });
});

describe('applying an import', () => {
  test('new spaces are added with the import time', () => {
    const lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    expect(lib.spaces.map((s) => [s.sourceId, s.space.name, s.importedAt])).toEqual([['s1', 'Work', NOW.toISOString()]]);
  });

  test('replace swaps in the incoming space and resets the edit check', () => {
    let lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    lib.spaces[0]!.space.name = 'Edited';
    lib = applyImport(lib, [space('s1', 'Work', 'https://new.example')], { s1: 'replace' }, NOW);
    expect(lib.spaces).toHaveLength(1);
    expect(lib.spaces[0]!.space.name).toBe('Work');
    expect(planImport(lib, [space('s1', 'Work')])[0]?.status).toBe('replace');
  });

  test('keep leaves the edited space untouched', () => {
    let lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    lib.spaces[0]!.space.name = 'Edited';
    lib = applyImport(lib, [space('s1', 'Work')], { s1: 'keep' }, NOW);
    expect(lib.spaces.map((s) => s.space.name)).toEqual(['Edited']);
  });

  test('copy adds the incoming space beside the edited one with a numbered name', () => {
    let lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    lib.spaces[0]!.space.name = 'Edited';
    lib = applyImport(lib, [space('s1', 'Work')], { s1: 'copy' }, NOW);
    lib = applyImport(lib, [space('s1', 'Work')], { s1: 'copy' }, NOW);
    expect(lib.spaces.map((s) => s.space.name)).toEqual(['Edited', 'Work (2)', 'Work (3)']);
    expect(new Set(lib.spaces.map((s) => s.space.id)).size).toBe(3);
  });

  test('a conflict without a decision is kept, never silently replaced', () => {
    let lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    lib.spaces[0]!.space.name = 'Edited';
    lib = applyImport(lib, [space('s1', 'Work')], {}, NOW);
    expect(lib.spaces.map((s) => s.space.name)).toEqual(['Edited']);
  });
});

describe('edit fingerprint', () => {
  test('does not depend on the order of fields', () => {
    const a: Space = { id: 's', name: 'W', arcProfile: 'default', pinned: [{ kind: 'tab', id: 't', url: 'https://a.example', title: 'A', customName: 'N' }], today: [] };
    const b = { today: [], pinned: [{ customName: 'N', title: 'A', url: 'https://a.example', id: 't', kind: 'tab' }], arcProfile: 'default', name: 'W', id: 's' } as Space;
    expect(spaceHash(a)).toBe(spaceHash(b));
  });
});

describe('saving and loading', () => {
  test('empty storage loads an empty library', async () => {
    expect(await loadLibrary(memoryStorage())).toEqual(emptyLibrary());
  });

  test('a saved library loads back the same', async () => {
    const storage = memoryStorage();
    const lib = applyImport(emptyLibrary(), [space('s1', 'Work')], {}, NOW);
    await saveLibrary(storage, lib);
    expect(await loadLibrary(storage)).toEqual(lib);
  });

  test('a corrupted stored value loads as empty instead of crashing', async () => {
    const storage = memoryStorage();
    storage.data.library = { version: 1, spaces: 'nonsense' };
    expect(await loadLibrary(storage)).toEqual(emptyLibrary());
  });
});
