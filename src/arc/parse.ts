import type { ArcSetup, Item, ParseResult, PinnedTab, Rgb, Skipped, Space } from '../model';

// Treat the file as untrusted: cap size, depth and item count; validate everything before anyone writes from it.
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_ITEMS = 200_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Arc stores maps as flat arrays: [id, value, id, value, ...]. */
function pairs(list: unknown): Map<string, Obj> {
  const out = new Map<string, Obj>();
  if (!Array.isArray(list)) return out;
  for (let i = 0; i + 1 < list.length && out.size < MAX_ITEMS; i += 2) {
    if (typeof list[i] === 'string' && isObj(list[i + 1])) out.set(list[i] as string, list[i + 1] as Obj);
  }
  return out;
}

/** Arc profile reference → "default" or the profile's folder name. */
function profileKey(p: unknown): string {
  const custom = isObj(p) && isObj(p.custom) && isObj(p.custom._0) ? str(p.custom._0.directoryBasename) : '';
  return custom || 'default';
}

function spaceColor(space: Obj): Rgb | undefined {
  const mid = (space.customInfo as any)?.windowTheme?.primaryColorPalette?.midTone;
  if (!isObj(mid)) return undefined;
  const c = (v: unknown) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255);
  return { r: c(mid.red), g: c(mid.green), b: c(mid.blue) };
}

export function parseArcSidebar(text: string): ParseResult {
  if (text.length > MAX_BYTES) return { ok: false, error: 'This file is too large to be an Arc sidebar file (over 50 MB).' };

  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { ok: false, error: 'This file is not valid JSON, so it is not an Arc sidebar file.' }; }

  const containers = isObj(doc) && isObj(doc.sidebar) && Array.isArray(doc.sidebar.containers) ? doc.sidebar.containers : null;
  const main = containers?.find((c) => isObj(c) && Array.isArray(c.spaces) && Array.isArray(c.items)) as Obj | undefined;
  if (!main) return { ok: false, error: 'This is not an Arc sidebar file (no spaces found). Pick StorableSidebar.json from Arc’s folder.' };

  const items = pairs(main.items);
  const skipped: Skipped[] = [];

  const toTab = (id: string, it: Obj): PinnedTab | null => {
    const tab = it.data && (it.data as Obj).tab;
    const url = isObj(tab) ? str(tab.savedURL).trim() : '';
    const title = isObj(tab) ? str(tab.savedTitle) : '';
    const name = str(it.title).trim();
    if (!url) { skipped.push({ reason: 'Pinned tab has no URL', title: name || title || undefined }); return null; }
    return { kind: 'tab', id, url, title, ...(name && name !== title ? { customName: name } : {}) };
  };

  // `seen` guards against cycles and items listed twice; depth guards against absurd nesting.
  const seen = new Set<string>();
  const children = (parentId: string, depth: number): Item[] => {
    const parent = items.get(parentId);
    const ids = parent && Array.isArray(parent.childrenIds) ? parent.childrenIds : [];
    const out: Item[] = [];
    for (const raw of ids) {
      const id = str(raw);
      const it = items.get(id);
      if (!it) continue;
      if (seen.has(id)) { skipped.push({ reason: 'Item repeated or part of a cycle', title: str(it.title) || undefined }); continue; }
      if (depth >= MAX_DEPTH) { skipped.push({ reason: 'Folder nested too deeply', title: str(it.title) || undefined }); continue; }
      seen.add(id);
      const item = toItem(id, it, depth + 1);
      if (item) out.push(item);
    }
    return out;
  };

  const toItem = (id: string, it: Obj, depth: number): Item | null => {
    const data = isObj(it.data) ? it.data : {};
    const title = str(it.title).trim();
    if ('tab' in data) return toTab(id, it);
    if ('list' in data) return { kind: 'folder', id, name: title || 'Untitled folder', children: children(id, depth) };
    if ('splitView' in data) {
      return { kind: 'split', id, tabs: children(id, depth).filter((c): c is PinnedTab => c.kind === 'tab') };
    }
    if ('arcDocument' in data) {
      const documentId = isObj(data.arcDocument) ? str(data.arcDocument.arcDocumentID) : '';
      return { kind: 'note', id, title: title || 'Untitled note', documentId };
    }
    if ('easel' in data) { skipped.push({ reason: 'Easels live on Arc’s servers and cannot be imported', title: title || undefined }); return null; }
    skipped.push({ reason: `Unsupported Arc item type: ${Object.keys(data)[0] ?? 'unknown'}`, title: title || undefined });
    return null;
  };

  const spaces: Space[] = [];
  for (const [sid, s] of pairs(main.spaces)) {
    const ids = Array.isArray(s.containerIDs) ? s.containerIDs : [];
    const after = (label: string) => { const i = ids.indexOf(label); return i >= 0 ? str(ids[i + 1]) : ''; };
    const color = spaceColor(s);
    spaces.push({
      id: sid,
      name: str(s.title).trim() || 'Untitled space',
      ...(color ? { color } : {}),
      arcProfile: profileKey(s.profile),
      pinned: children(after('pinned'), 0),
      today: children(after('unpinned'), 0).filter((c): c is PinnedTab => c.kind === 'tab'),
    });
  }

  const favorites: ArcSetup['favorites'] = {};
  for (const [id, it] of items) {
    const top = (it.data as any)?.itemContainer?.containerType?.topApps;
    if (!isObj(top)) continue;
    const key = profileKey(top._0);
    favorites[key] = [...(favorites[key] ?? []), ...children(id, 0).filter((c): c is PinnedTab => c.kind === 'tab')];
  }

  return { ok: true, setup: { spaces, favorites, skipped } };
}
