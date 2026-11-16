import { describe, expect, test } from 'vitest';
import { parseArcSidebar } from './parse';
import { ArcFixture, customProfile } from '../../test/arcFixture';
import type { ArcSetup, Folder, PinnedTab } from '../model';

/** Indexed access that fails loudly instead of returning undefined. */
const at = <T>(list: T[], i = 0): T => { const v = list[i]; if (v === undefined) throw new Error(`no item at ${i}`); return v; };

const parse = (f: ArcFixture): ArcSetup => {
  const r = parseArcSidebar(f.json());
  if (!r.ok) throw new Error('parse failed: ' + r.error);
  return r.setup;
};

describe('spaces, folders and pinned tabs', () => {
  test('keeps nested folders in order with their pinned tabs', () => {
    const f = new ArcFixture();
    f.space('Work', {
      pinned: (p) => {
        f.tab(p, 'https://a.example', 'A');
        f.folder(p, 'Tools', (t) => {
          f.tab(t, 'https://b.example', 'B');
          f.folder(t, 'Deep', (d) => f.tab(d, 'https://c.example', 'C'));
        });
      },
    });
    const space = at(parse(f).spaces);
    expect(space.name).toBe('Work');
    expect(space.pinned.map((i) => i.kind)).toEqual(['tab', 'folder']);
    const tools = space.pinned[1] as Folder;
    expect(tools.name).toBe('Tools');
    expect((at(tools.children) as PinnedTab).url).toBe('https://b.example');
    expect((at((at(tools.children, 1) as Folder).children) as PinnedTab).url).toBe('https://c.example');
  });

  test('custom name is kept only when the person renamed the tab', () => {
    const f = new ArcFixture();
    f.space('S', {
      pinned: (p) => {
        f.tab(p, 'https://x.example', 'Callcenter :: login', 'Tamashobana');
        f.tab(p, 'https://y.example', 'Same Title', 'Same Title');
        f.tab(p, 'https://z.example', 'Untouched');
      },
    });
    const tabs = at(parse(f).spaces).pinned as PinnedTab[];
    expect(tabs.map((t) => t.customName)).toEqual(['Tamashobana', undefined, undefined]);
    expect(at(tabs).title).toBe('Callcenter :: login');
  });

  test('today tabs come from the unpinned container', () => {
    const f = new ArcFixture();
    f.space('S', { today: (t) => f.tab(t, 'https://today.example', 'Today') });
    const space = at(parse(f).spaces);
    expect(space.pinned).toEqual([]);
    expect(space.today.map((t) => t.url)).toEqual(['https://today.example']);
  });

  test('space keeps its Arc profile and color', () => {
    const f = new ArcFixture();
    f.space('Default one');
    f.space('Custom one', { profile: customProfile('Profile 3'), color: [1, 0, 0.5] });
    const spaces = parse(f).spaces;
    const a = at(spaces), b = at(spaces, 1);
    expect(a.arcProfile).toBe('default');
    expect(b.arcProfile).toBe('Profile 3');
    expect(b.color).toEqual({ r: 255, g: 0, b: 128 });
  });
});

describe('favorites and other item kinds', () => {
  test('favorites are grouped by Arc profile', () => {
    const f = new ArcFixture();
    f.favorites({ default: true }, (c) => f.tab(c, 'https://mail.example', 'Mail'));
    f.favorites(customProfile('Profile 3'), (c) => f.tab(c, 'https://chat.example', 'Chat'));
    const favs = parse(f).favorites;
    expect(favs.default!.map((t) => t.url)).toEqual(['https://mail.example']);
    expect(favs['Profile 3']!.map((t) => t.url)).toEqual(['https://chat.example']);
  });

  test('split view keeps its tabs together', () => {
    const f = new ArcFixture();
    f.space('S', { pinned: (p) => f.split(p, (s) => { f.tab(s, 'https://l.example', 'L'); f.tab(s, 'https://r.example', 'R'); }) });
    const split = at(at(parse(f).spaces).pinned);
    expect(split.kind).toBe('split');
    expect(split.kind === 'split' && split.tabs.map((t) => t.url)).toEqual(['https://l.example', 'https://r.example']);
  });

  test('notes are kept, easels and unknown kinds are skipped and reported', () => {
    const f = new ArcFixture();
    f.space('S', {
      pinned: (p) => {
        f.raw(p, { arcDocument: { arcDocumentID: 'doc-1' } }, 'Ideas');
        f.raw(p, { easel: { easelID: 'e-1', title: 'Board' } }, 'Board');
        f.raw(p, { somethingNew: {} }, 'Mystery');
      },
    });
    const setup = parse(f);
    expect(at(setup.spaces).pinned).toEqual([{ kind: 'note', id: expect.any(String), title: 'Ideas', documentId: 'doc-1' }]);
    expect(setup.skipped.map((s) => s.title)).toEqual(['Board', 'Mystery']);
    expect(at(setup.skipped).reason).toMatch(/easel/i);
  });
});

describe('untrusted input', () => {
  test('rejects text that is not JSON', () => {
    expect(parseArcSidebar('not json')).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/i) });
  });

  test('rejects JSON that is not an Arc sidebar file', () => {
    expect(parseArcSidebar('{"hello":1}')).toEqual({ ok: false, error: expect.stringMatching(/not an Arc sidebar file/i) });
  });

  test('rejects files over 50 MB without parsing them', () => {
    const r = parseArcSidebar(' '.repeat(50 * 1024 * 1024 + 1));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/too large/i) });
  });

  test('survives a folder that contains itself', () => {
    const f = new ArcFixture();
    let loop = '';
    f.space('S', { pinned: (p) => { loop = f.folder(p, 'Loop', (l) => f.tab(l, 'https://a.example', 'A')); } });
    f.setChildren(loop, [loop]);
    const setup = parse(f);
    expect((at(at(setup.spaces).pinned) as Folder).children).toEqual([]);
    expect(setup.skipped.some((s) => /cycle|repeated/i.test(s.reason))).toBe(true);
  });

  test('ignores children that point at missing items', () => {
    const f = new ArcFixture();
    let folder = '';
    f.space('S', { pinned: (p) => { folder = f.folder(p, 'F'); } });
    f.setChildren(folder, ['does-not-exist']);
    expect((at(at(parse(f).spaces).pinned) as Folder).children).toEqual([]);
  });

  test('drops tabs without a URL and reports them', () => {
    const f = new ArcFixture();
    f.space('S', { pinned: (p) => f.tab(p, '', 'Empty') });
    const setup = parse(f);
    expect(at(setup.spaces).pinned).toEqual([]);
    expect(at(setup.skipped)).toEqual({ reason: expect.stringMatching(/no URL/i), title: 'Empty' });
  });
});
