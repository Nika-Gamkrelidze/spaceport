import { describe, expect, test } from 'vitest';
import { previewSpaces, runImport, undoLastImport, type ImportDeps } from './run';
import { emptyLibrary, applyImport, loadLibrary, saveLibrary, type Library } from '../store/library';
import { decodeTransfer } from '../transfer/transfer';
import { FakeBrowser } from '../../test/fakeBrowser';
import { FakeStorage } from '../../test/fakeRun';
import type { ArcSetup, Item, PinnedTab, Space } from '../model';

let n = 0;
const tab = (url: string): PinnedTab => ({ kind: 'tab', id: `t${++n}`, url, title: url });
const folder = (name: string, children: Item[]): Item => ({ kind: 'folder', id: `f${++n}`, name, children });
const split = (...tabs: PinnedTab[]): Item => ({ kind: 'split', id: `sp${++n}`, tabs });
const space = (id: string, name: string, pinned: Item[] = [], today: PinnedTab[] = [], arcProfile = 'default'): Space =>
  // Same key order as the parser and validator: spaceHash is order-sensitive.
  ({ id, name, color: { r: 40, g: 90, b: 230 }, arcProfile, pinned, today });
const setupOf = (spaces: Space[], extra: Partial<ArcSetup> = {}): ArcSetup => ({ spaces, favorites: {}, skipped: [], ...extra });
const now = new Date('2026-11-16T10:00:00Z');

describe('previewSpaces', () => {
  test('one preview per space in order, with status, profile, color and counts', () => {
    const work = space('w', 'Work', [
      tab('https://a.example'),
      folder('Tools', [tab('https://b.example'), folder('Deep', [split(tab('https://c.example'), tab('https://d.example'))])]),
      { kind: 'note', id: 'n1', title: 'Note', documentId: 'd1' },
    ], [tab('https://today.example')], 'Personal');
    const home = space('h', 'Home');
    const lib = applyImport(emptyLibrary(), [home], {}, now);
    expect(previewSpaces(lib, setupOf([work, home]))).toEqual([
      { sourceId: 'w', name: 'Work', status: 'new', arcProfile: 'Personal', color: { r: 40, g: 90, b: 230 }, pinned: 4, folders: 2, today: 1 },
      { sourceId: 'h', name: 'Home', status: 'replace', arcProfile: 'default', color: { r: 40, g: 90, b: 230 }, pinned: 0, folders: 0, today: 0 },
    ]);
  });
});

const depsOf = (b = new FakeBrowser(), storage = new FakeStorage()) =>
  ({ b, storage, deps: { bookmarks: b.bookmarks, groups: b, storage, now: () => now } satisfies ImportDeps });
/** A library holding `sp` as imported, then edited by the person (so re-import is a conflict). */
const editedLibrary = (sp: Space): Library => {
  const lib = applyImport(emptyLibrary(), [sp], {}, now);
  lib.spaces[0] = { ...lib.spaces[0]!, space: { ...sp, name: `${sp.name} edited` } };
  return lib;
};

describe('runImport', () => {
  test('adds chosen spaces, saves the library with their favorites, writes the bookmark copy, opens nothing in space mode', async () => {
    const { b, storage, deps } = depsOf();
    const work = space('w', 'Work', [tab('https://a.example'), tab('not a url')]);
    const other = space('o', 'Other', [tab('https://o.example')], [], 'Personal');
    const setup = setupOf([work, other], {
      favorites: { default: [tab('https://fav.example')], Personal: [tab('https://pfav.example')] },
      skipped: [{ reason: 'easel', title: 'Board' }],
    });
    const report = await runImport(deps, { setup, spaceIds: ['w', 'nope'], mode: 'space', decisions: {} });

    const lib = await loadLibrary(storage);
    expect(lib.spaces.map((s) => s.space.name)).toEqual(['Work']);
    expect(Object.keys(lib.favorites)).toEqual(['default']);
    expect(b.bookmarks.find('Arc – Work')?.children?.map((c) => c.url)).toEqual(['https://a.example']);
    expect(b.bookmarks.find('Arc – Favorites')?.children?.map((c) => c.url)).toEqual(['https://fav.example']);
    expect(b.bookmarks.find('Arc – Other')).toBeUndefined();
    expect(b.windowIds.size).toBe(0);
    expect(storage.data.undoSnapshot).toBeUndefined();
    expect(report).toEqual({
      spaces: [{ name: 'Work', outcome: 'added' }], bookmarksCreated: 2, groupsCreated: 0, tabsOpened: 0, failedUrls: [],
      skipped: [{ reason: 'easel', title: 'Board' }, { reason: 'unsupported URL', title: 'not a url' }], undoAvailable: false,
    });
  });

  test('folder mode opens folder groups per imported space and reports failed URLs', async () => {
    const { b, deps } = depsOf();
    b.failUrls.add('https://broken.example');
    const work = space('w', 'Work', [tab('https://a.example'), folder('Tools', [tab('https://b.example'), tab('https://broken.example')])]);
    const home = space('h', 'Home', [tab('https://h.example')]);
    const report = await runImport(deps, { setup: setupOf([work, home]), spaceIds: ['w', 'h'], mode: 'folder', decisions: {} });
    expect(b.groups().map((g) => g.title).sort()).toEqual(['Home', 'Tools', 'Work']);
    expect(report).toMatchObject({ groupsCreated: 3, tabsOpened: 3, failedUrls: ['https://broken.example'] });
  });

  test('replacing a space first saves the previous library as an undo transfer file', async () => {
    const { b, storage, deps } = depsOf();
    const old = space('w', 'Work', [tab('https://old.example')]);
    const before = { ...applyImport(emptyLibrary(), [old], {}, now), favorites: { default: [tab('https://oldfav.example')] } };
    await saveLibrary(storage, before);
    const report = await runImport(deps, { setup: setupOf([space('w', 'Work', [tab('https://new.example')])]), spaceIds: ['w'], mode: 'space', decisions: {} });

    expect(report.spaces).toEqual([{ name: 'Work', outcome: 'replaced' }]);
    expect(report.undoAvailable).toBe(true);
    const decoded = await decodeTransfer(storage.data.undoSnapshot as string);
    expect(decoded.ok && decoded.setup).toEqual({ spaces: [old], favorites: before.favorites, skipped: [] });
    expect((await loadLibrary(storage)).spaces[0]!.space.pinned).toEqual([expect.objectContaining({ url: 'https://new.example' })]);
    expect(b.bookmarks.find('Arc – Work')?.children?.map((c) => c.url)).toEqual(['https://new.example']);
  });

  test('a conflict without a decision is kept: no snapshot, no bookmark copy', async () => {
    const { b, storage, deps } = depsOf();
    const sp = space('w', 'Work', [tab('https://a.example')]);
    await saveLibrary(storage, editedLibrary(sp));
    const report = await runImport(deps, { setup: setupOf([sp]), spaceIds: ['w'], mode: 'folder', decisions: {} });
    expect(report.spaces).toEqual([{ name: 'Work', outcome: 'kept' }]);
    expect(report.undoAvailable).toBe(false);
    expect(storage.data.undoSnapshot).toBeUndefined();
    expect(b.bookmarks.find('Arc – Work')).toBeUndefined();
    expect(b.windowIds.size).toBe(0);
    expect((await loadLibrary(storage)).spaces.map((s) => s.space.name)).toEqual(['Work edited']);
  });

  test('a conflict imported as copy keeps the edited space and bookmarks the copy', async () => {
    const { b, storage, deps } = depsOf();
    const sp = space('w', 'Work', [tab('https://a.example')]);
    await saveLibrary(storage, editedLibrary(sp));
    const report = await runImport(deps, { setup: setupOf([sp]), spaceIds: ['w'], mode: 'space', decisions: { w: 'copy' } });
    expect(report.spaces).toEqual([{ name: 'Work', outcome: 'copied' }]);
    expect(report.undoAvailable).toBe(false);
    expect((await loadLibrary(storage)).spaces.map((s) => s.space.name)).toEqual(['Work edited', 'Work (2)']);
    expect(b.bookmarks.find('Arc – Work (2)')).toBeDefined();
  });

  test('a conflict with decision replace is replaced after saving the undo snapshot', async () => {
    const { storage, deps } = depsOf();
    const sp = space('w', 'Work', [tab('https://a.example')]);
    await saveLibrary(storage, editedLibrary(sp));
    const report = await runImport(deps, { setup: setupOf([sp]), spaceIds: ['w'], mode: 'space', decisions: { w: 'replace' } });
    expect(report.spaces).toEqual([{ name: 'Work', outcome: 'replaced' }]);
    expect(report.undoAvailable).toBe(true);
    const decoded = await decodeTransfer(storage.data.undoSnapshot as string);
    expect(decoded.ok && decoded.setup.spaces.map((s) => s.name)).toEqual(['Work edited']);
  });

  test('bookmark and group failures are reported without losing the saved library', async () => {
    const { b, storage, deps } = depsOf();
    b.bookmarks.getTree = async () => { throw new Error('bookmarks down'); };
    b.windows.create = async () => { throw new Error('no windows'); };
    const report = await runImport(deps, { setup: setupOf([space('w', 'Work', [tab('https://a.example')])]), spaceIds: ['w'], mode: 'folder', decisions: {} });
    expect((await loadLibrary(storage)).spaces.map((s) => s.space.name)).toEqual(['Work']);
    expect(report.spaces).toEqual([{ name: 'Work', outcome: 'added' }]);
    expect(report.skipped).toEqual([
      { reason: 'bookmark copy failed: bookmarks down' },
      { reason: 'tab groups failed: no windows', title: 'Work' },
    ]);
  });
});

describe('undoLastImport', () => {
  test('returns false when there is nothing to undo', async () => {
    const storage = new FakeStorage();
    expect(await undoLastImport({ storage })).toBe(false);
    expect(storage.data).toEqual({});
  });

  test('restores the library from before the replacing import and removes the snapshot', async () => {
    const { storage, deps } = depsOf();
    const old = space('w', 'Work', [tab('https://old.example')]);
    const oldFavs = { default: [tab('https://oldfav.example')] };
    await saveLibrary(storage, { ...applyImport(emptyLibrary(), [old], {}, now), favorites: oldFavs });
    await runImport(deps, {
      setup: setupOf([space('w', 'Work', [tab('https://new.example')]), space('h', 'Home')], { favorites: { default: [tab('https://newfav.example')] } }),
      spaceIds: ['w', 'h'], mode: 'space', decisions: {},
    });

    expect(await undoLastImport({ storage })).toBe(true);
    const lib = await loadLibrary(storage);
    expect(lib.spaces.map((s) => s.space)).toEqual([old]);
    expect(lib.spaces[0]!.sourceId).toBe('w');
    expect(lib.favorites).toEqual(oldFavs);
    expect(await undoLastImport({ storage })).toBe(false);
  });
});
