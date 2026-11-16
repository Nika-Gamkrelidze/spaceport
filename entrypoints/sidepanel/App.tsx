import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { nearestGroupColor, type GroupColor } from '../../src/import/colors';
import type { Item, PinnedTab, Space } from '../../src/model';
import { backToPinned, openPinned, pinnedStates, switchSpace, type PinnedState } from '../../src/sidebar/actions';
import { moveItem, removeItem, removeSpace, renameItem, renameSpace, restore, type Removed } from '../../src/store/edit';
import { emptyLibrary, loadLibrary, saveLibrary, type Library } from '../../src/store/library';
import { groupColorVar, openImportPage, sidebarApi, storage } from '../../src/ui/env';
import './sidepanel.css';

const label = (t: PinnedTab) => t.customName || t.title || hostOf(t.url);
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** Visible rows of a space's pinned tree, flattened for keyboard navigation and drag-and-drop. */
interface Row { item: Item; depth: number; parentId: string | null; index: number }
function flatten(items: Item[], open: Set<string>, query: string, depth = 0, parentId: string | null = null): Row[] {
  const out: Row[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'folder') {
      const kids = flatten(item.children, open, query, depth + 1, item.id);
      const show = !query || kids.length > 0 || item.name.toLowerCase().includes(query);
      if (!show) return;
      out.push({ item, depth, parentId, index });
      if (open.has(item.id) || query) out.push(...kids);
    } else if (!query || matches(item, query)) out.push({ item, depth, parentId, index });
  });
  return out;
}
const matches = (item: Item, q: string): boolean =>
  item.kind === 'tab' ? `${label(item)} ${item.url}`.toLowerCase().includes(q)
  : item.kind === 'split' ? item.tabs.some((t) => matches(t, q))
  : item.kind === 'note' ? item.title.toLowerCase().includes(q) : false;

export default function App() {
  const [lib, setLib] = useState<Library>(emptyLibrary());
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [windowId, setWindowId] = useState<number>();
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState<{ removed: Removed; text: string }>();
  const api = useMemo(sidebarApi, []);

  useEffect(() => {
    const refresh = () => loadLibrary(storage).then((l) => { setLib(l); setLoaded(true); });
    refresh();
    storage.get('activeSpace').then((r) => typeof r.activeSpace === 'string' && setActiveId(r.activeSpace));
    browser.windows.getCurrent().then((w) => setWindowId(w.id));
    const onChange = (changes: Record<string, unknown>, area: string) => { if (area === 'local' && 'library' in changes) refresh(); };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  const spaces = lib.spaces.map((s) => s.space);
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const commit = useCallback(async (next: Library) => { setLib(next); await saveLibrary(storage, next); }, []);

  const choose = async (space: Space) => {
    setActiveId(space.id);
    setQuery('');
    storage.set({ activeSpace: space.id });
    if (windowId !== undefined) await switchSpace(api, { windowId, active: space.name, all: spaces.map((s) => s.name) }).catch(() => {});
  };

  const remove = async (fn: () => { lib: Library; removed: Removed | null }, text: string) => {
    const r = fn();
    if (!r.removed) return;
    await commit(r.lib);
    setUndo({ removed: r.removed, text });
  };

  if (!loaded) return null;
  if (!active) return <Empty />;

  return (
    <div className="shell">
      <Rail spaces={spaces} activeId={active.id} onChoose={choose} />
      <main className="pane" aria-label={`Space ${active.name}`}>
        <SpaceHeader
          space={active}
          query={query}
          onQuery={setQuery}
          onRename={(name) => commit(renameSpace(lib, active.id, name))}
          onRemove={() => remove(() => removeSpace(lib, active.id), `Removed space ${active.name}`)}
        />
        <Favorites lib={lib} space={active} windowId={windowId} />
        <Tree
          key={active.id}
          space={active}
          query={query.trim().toLowerCase()}
          windowId={windowId}
          onRename={(id, name) => commit(renameItem(lib, active.id, id, name))}
          onMove={(id, parent, index) => commit(moveItem(lib, active.id, id, parent, index))}
          onRemove={(item) => remove(() => removeItem(lib, active.id, item.id), `Removed ${item.kind === 'folder' ? item.name : item.kind === 'tab' ? label(item) : 'item'}`)}
        />
        <Today space={active} windowId={windowId} query={query.trim().toLowerCase()} />
      </main>
      {undo && (
        <div className="toast" role="status">
          <span>{undo.text}</span>
          <button className="btn btn-quiet" onClick={async () => { await commit(restore(lib, undo.removed)); setUndo(undefined); }}>Undo</button>
          <button className="btn btn-quiet" aria-label="Dismiss" onClick={() => setUndo(undefined)}>✕</button>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="empty">
      <h1>No spaces here yet</h1>
      <p className="muted">Bring your Arc spaces into this profile. Your folders, pinned tabs and their names come with them.</p>
      <button className="btn btn-primary" onClick={openImportPage}>Import from Arc</button>
    </div>
  );
}

function Rail({ spaces, activeId, onChoose }: { spaces: Space[]; activeId: string; onChoose: (s: Space) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1;
    if (next < 0 || next >= spaces.length) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChoose(spaces[next]!);
  };
  useEffect(() => {
    // ⌘/Ctrl+Shift+1…9 switches spaces while the sidebar has focus.
    const h = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && n >= 1 && n <= 9 && spaces[n - 1]) { e.preventDefault(); onChoose(spaces[n - 1]!); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [spaces, onChoose]);
  return (
    <nav className="rail" role="tablist" aria-orientation="vertical" aria-label="Spaces">
      {spaces.map((s, i) => {
        const on = s.id === activeId;
        return (
          <button
            key={s.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            title={`${s.name}${i < 9 ? ` (⌘⇧${i + 1})` : ''}`}
            className={`berth ${on ? 'is-on' : ''}`}
            style={{ '--c': groupColorVar(nearestGroupColor(s.color)) } as React.CSSProperties}
            onClick={() => onChoose(s)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="berth-letter">{s.name.trim().charAt(0).toUpperCase()}</span>
            <span className="visually-hidden">{s.name}</span>
          </button>
        );
      })}
      <button className="berth berth-add" title="Import more spaces" aria-label="Import more spaces" onClick={openImportPage}>+</button>
    </nav>
  );
}

function SpaceHeader({ space, query, onQuery, onRename, onRemove }: {
  space: Space; query: string; onQuery: (q: string) => void; onRename: (n: string) => void; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <header className="space-head">
      {editing
        ? <RenameInput initial={space.name} onDone={(v) => { setEditing(false); if (v !== null) onRename(v); }} label="Space name" />
        : <h1 className="space-title" onDoubleClick={() => setEditing(true)}>{space.name}</h1>}
      <div className="head-actions">
        <button className="btn btn-quiet" onClick={() => setEditing(true)} aria-label={`Rename space ${space.name}`}>Rename</button>
        <button className="btn btn-quiet" onClick={onRemove} aria-label={`Remove space ${space.name}`}>Remove</button>
      </div>
      <input className="input search" type="search" placeholder="Search this space" aria-label="Search this space" value={query} onChange={(e) => onQuery(e.target.value)} />
    </header>
  );
}

function Favorites({ lib, space, windowId }: { lib: Library; space: Space; windowId?: number }) {
  const favs = lib.favorites[space.arcProfile] ?? [];
  const api = useMemo(sidebarApi, []);
  if (!favs.length || windowId === undefined) return null;
  return (
    <ul className="favs" aria-label="Favorites">
      {favs.map((t) => (
        <li key={t.id}>
          <button className="fav" title={label(t)} onClick={() => openPinned(api, { pinnedId: t.id, url: t.url, spaceName: space.name, color: nearestGroupColor(space.color), windowId })}>
            {label(t).charAt(0).toUpperCase()}<span className="visually-hidden">{label(t)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function usePinnedStates(space: Space) {
  const api = useMemo(sidebarApi, []);
  const [states, setStates] = useState<Record<string, PinnedState>>({});
  useEffect(() => {
    const all: { pinnedId: string; url: string }[] = [];
    const walk = (items: Item[]) => items.forEach((i) => i.kind === 'tab' ? all.push({ pinnedId: i.id, url: i.url })
      : i.kind === 'folder' ? walk(i.children) : i.kind === 'split' ? walk(i.tabs) : undefined);
    walk(space.pinned);
    walk(space.today);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => pinnedStates(api, all).then(setStates).catch(() => {}), 150); };
    refresh();
    browser.tabs.onUpdated.addListener(refresh);
    browser.tabs.onRemoved.addListener(refresh);
    browser.tabs.onCreated.addListener(refresh);
    return () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(refresh);
      browser.tabs.onRemoved.removeListener(refresh);
      browser.tabs.onCreated.removeListener(refresh);
    };
  }, [space, api]);
  return states;
}

function Tree({ space, query, windowId, onRename, onMove, onRemove }: {
  space: Space; query: string; windowId?: number;
  onRename: (id: string, name: string) => void; onMove: (id: string, parent: string | null, index: number) => void; onRemove: (item: Item) => void;
}) {
  const api = useMemo(sidebarApi, []);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const states = usePinnedStates(space);
  const rows = flatten(space.pinned, open, query);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const color: GroupColor = nearestGroupColor(space.color);

  const toggle = (id: string, to?: boolean) => setOpen((s) => { const n = new Set(s); (to ?? !n.has(id)) ? n.add(id) : n.delete(id); return n; });
  const openTab = (t: PinnedTab) => windowId !== undefined && openPinned(api, { pinnedId: t.id, url: t.url, spaceName: space.name, color, windowId });
  const activate = (item: Item) => item.kind === 'folder' ? toggle(item.id) : item.kind === 'tab' ? openTab(item) : item.kind === 'split' ? item.tabs.forEach(openTab) : undefined;
  const move = (i: number) => { const n = Math.max(0, Math.min(rows.length - 1, i)); setFocus(n); refs.current[n]?.focus(); };

  const onKey = (e: React.KeyboardEvent, i: number, row: Row) => {
    if (editing) return;
    const it = row.item;
    switch (e.key) {
      case 'ArrowDown': move(i + 1); break;
      case 'ArrowUp': move(i - 1); break;
      case 'ArrowRight': if (it.kind === 'folder') open.has(it.id) ? move(i + 1) : toggle(it.id, true); break;
      case 'ArrowLeft':
        if (it.kind === 'folder' && open.has(it.id)) toggle(it.id, false);
        else if (row.parentId) move(rows.findIndex((r) => r.item.id === row.parentId));
        break;
      case 'Enter': activate(it); break;
      case 'F2': setEditing(it.id); break;
      case 'Delete': case 'Backspace': onRemove(it); break;
      default: return;
    }
    e.preventDefault();
  };

  const drop = (target: Row) => {
    if (!dragId || dragId === target.item.id) return;
    if (target.item.kind === 'folder') onMove(dragId, target.item.id, target.item.children.length);
    else onMove(dragId, target.parentId, target.index);
    setDragId(undefined);
  };

  if (!rows.length) return <p className="muted pad">{query ? 'Nothing in this space matches.' : 'No pinned tabs in this space.'}</p>;

  return (
    <div className="tree" role="tree" aria-label="Pinned tabs">
      {rows.map((row, i) => {
        const it = row.item;
        const name = it.kind === 'folder' ? it.name : it.kind === 'tab' ? label(it) : it.kind === 'note' ? it.title : it.tabs.map(label).join(' | ');
        const state = it.kind === 'tab' ? states[it.id] : undefined;
        return (
          <div
            key={it.id}
            ref={(el) => { refs.current[i] = el; }}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={it.kind === 'folder' ? open.has(it.id) || !!query : undefined}
            aria-label={it.kind === 'split' ? `Split view: ${name}` : it.kind === 'note' ? `Note: ${name}` : name}
            tabIndex={i === focus ? 0 : -1}
            className={`row kind-${it.kind} ${state ? `is-${state}` : ''} ${dragId === it.id ? 'is-dragging' : ''}`}
            style={{ paddingLeft: 10 + row.depth * 14 }}
            draggable={!editing && !query}
            onDragStart={() => setDragId(it.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(row)}
            onFocus={() => setFocus(i)}
            onKeyDown={(e) => onKey(e, i, row)}
            onClick={() => { setFocus(i); if (it.kind !== 'note') activate(it); }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(it.id); }}
            title={it.kind === 'tab' ? it.url : undefined}
          >
            <span className="row-icon" aria-hidden>{it.kind === 'folder' ? (open.has(it.id) || query ? '▾' : '▸') : it.kind === 'split' ? '◫' : it.kind === 'note' ? '✎' : <span className="dot" />}</span>
            {editing === it.id
              ? <RenameInput initial={name} label="Name" onDone={(v) => { setEditing(undefined); if (v !== null) onRename(it.id, v); refs.current[i]?.focus(); }} />
              : <span className="row-name">{name}</span>}
            {state === 'away' && it.kind === 'tab' && (
              <button className="btn btn-quiet back" aria-label={`Back to pinned page for ${name}`} title="Back to pinned page"
                onClick={(e) => { e.stopPropagation(); backToPinned(api, it.id, it.url).catch(() => {}); }}>↩</button>
            )}
            <button className="btn btn-quiet row-remove" aria-label={`Remove ${name}`} tabIndex={-1} onClick={(e) => { e.stopPropagation(); onRemove(it); }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

function Today({ space, windowId, query }: { space: Space; windowId?: number; query: string }) {
  const api = useMemo(sidebarApi, []);
  const today = space.today.filter((t) => !query || matches(t, query));
  if (!today.length) return null;
  return (
    <section className="today" aria-label="Today">
      <h2>Today</h2>
      <ul>
        {today.map((t) => (
          <li key={t.id}>
            <button className="row kind-tab" title={t.url} onClick={() => windowId !== undefined && openPinned(api, { pinnedId: t.id, url: t.url, spaceName: space.name, color: nearestGroupColor(space.color), windowId })}>
              <span className="row-icon" aria-hidden><span className="dot" /></span><span className="row-name">{label(t)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RenameInput({ initial, label: aria, onDone }: { initial: string; label: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      className="input rename" aria-label={aria} value={v} autoFocus
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onDone(v); if (e.key === 'Escape') onDone(null); }}
      onBlur={() => onDone(v)}
    />
  );
}
