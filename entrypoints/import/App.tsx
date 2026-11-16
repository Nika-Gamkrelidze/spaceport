import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { parseArcSidebar } from '../../src/arc/parse';
import { nearestGroupColor } from '../../src/import/colors';
import { previewSpaces, runImport, undoLastImport, type GroupMode, type ImportReport, type SpacePreview } from '../../src/import/run';
import { loadLibrary, type Decision } from '../../src/store/library';
import { decodeTransfer, encodeTransfer } from '../../src/transfer/transfer';
import type { ArcSetup } from '../../src/model';
import { groupColorVar, importDeps, saveTextFile, storage } from '../../src/ui/env';
import './import.css';

const ARC_SHUTDOWN = new Date('2026-12-22T00:00:00');
const isWindows = navigator.userAgent.includes('Windows');
const ARC_FOLDER = isWindows
  ? '%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache\\Local\\Arc'
  : '~/Library/Application Support/Arc';

type Stage =
  | { name: 'pick'; error?: string }
  | { name: 'passphrase'; text: string; error?: string }
  | { name: 'choose'; setup: ArcSetup; previews: SpacePreview[]; source: string }
  | { name: 'running' }
  | { name: 'done'; report: ImportReport; undone?: boolean };

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const daysLeft = Math.ceil((ARC_SHUTDOWN.getTime() - Date.now()) / 86_400_000);

  async function accept(setup: ArcSetup, source: string) {
    const previews = previewSpaces(await loadLibrary(storage), setup);
    setStage({ name: 'choose', setup, previews, source });
  }

  async function readText(text: string, passphrase?: string) {
    if (text.includes('"spaceport-transfer"')) {
      const r = await decodeTransfer(text, passphrase);
      if (r.ok) return accept(r.setup, 'Spaceport transfer file');
      return setStage(r.needsPassphrase || passphrase ? { name: 'passphrase', text, error: passphrase ? r.error : undefined } : { name: 'pick', error: r.error });
    }
    const r = parseArcSidebar(text);
    if (r.ok) return accept(r.setup, 'Arc sidebar file');
    setStage({ name: 'pick', error: r.error });
  }

  return (
    <main className="page">
      <header className="page-head">
        <h1>Move your Arc spaces into this browser</h1>
        <p className="muted">
          Spaces, folders and pinned tabs come across with the names you gave them. Nothing leaves this browser.
        </p>
        {daysLeft > 0 && (
          <p className="deadline">
            Arc stops working in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}. Easels live on Arc’s servers and can’t be
            imported: export them in Arc first (Library → Easels → Export All Easels).
          </p>
        )}
      </header>

      <ol className="steps">
        <Step n={1} title="Pick your Arc data" active={stage.name === 'pick' || stage.name === 'passphrase'} done={!['pick', 'passphrase'].includes(stage.name)}>
          {stage.name === 'pick' && <Picker error={stage.error} onText={readText} />}
          {stage.name === 'passphrase' && <Passphrase error={stage.error} onSubmit={(p) => readText(stage.text, p)} onCancel={() => setStage({ name: 'pick' })} />}
          {!['pick', 'passphrase'].includes(stage.name) && stage.name === 'choose' && (
            <p className="muted">Read from {stage.source}. <button className="btn btn-quiet" onClick={() => setStage({ name: 'pick' })}>Pick another file</button></p>
          )}
        </Step>

        <Step n={2} title="Choose spaces for this profile" active={stage.name === 'choose'} done={stage.name === 'running' || stage.name === 'done'}>
          {stage.name === 'choose' && (
            <Chooser setup={stage.setup} previews={stage.previews} onRun={async (spaceIds, mode, decisions) => {
              setStage({ name: 'running' });
              const report = await runImport(importDeps(), { setup: stage.setup, spaceIds, mode, decisions });
              setStage({ name: 'done', report });
            }} />
          )}
        </Step>

        <Step n={3} title="Import" active={stage.name === 'running' || stage.name === 'done'} done={false}>
          {stage.name === 'running' && <p role="status">Importing…</p>}
          {stage.name === 'done' && <Summary report={stage.report} undone={stage.undone} onUndo={async () => {
            if (await undoLastImport({ storage })) setStage({ ...stage, undone: true });
          }} />}
        </Step>
      </ol>
    </main>
  );
}

function Step(props: { n: number; title: string; active: boolean; done: boolean; children?: React.ReactNode }) {
  return (
    <li className={`step ${props.active ? 'is-active' : ''} ${props.done ? 'is-done' : ''}`} aria-current={props.active ? 'step' : undefined}>
      <span className="step-n" aria-hidden>{props.done ? '✓' : props.n}</span>
      <div className="step-body">
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </li>
  );
}

function Picker({ error, onText }: { error?: string; onText: (t: string) => void }) {
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const read = (file?: File) => file && file.text().then(onText);
  return (
    <div>
      <p>
        Choose <strong>StorableSidebar.json</strong> from Arc’s folder. The folder is hidden, so
        {isWindows ? ' paste this into the file dialog’s address bar:' : ' press ⌘⇧G in the file dialog and paste:'}
      </p>
      <div className="path">
        <code>{ARC_FOLDER}</code>
        <button className="btn btn-quiet" onClick={() => navigator.clipboard.writeText(ARC_FOLDER).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy path'}
        </button>
      </div>
      <label
        className={`drop ${over ? 'is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]); }}
      >
        <input type="file" accept=".json,application/json" className="visually-hidden" onChange={(e) => read(e.target.files?.[0])} />
        <span className="btn btn-primary">Choose file</span>
        <span className="muted">or drop it here. A Spaceport transfer file works too.</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function Passphrase({ error, onSubmit, onCancel }: { error?: string; onSubmit: (p: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
      <label htmlFor="pass">This transfer file is protected. Enter its password.</label>
      <input id="pass" type="password" className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="btn btn-primary" disabled={!value}>Open file</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function Chooser({ setup, previews, onRun }: {
  setup: ArcSetup; previews: SpacePreview[];
  onRun: (ids: string[], mode: GroupMode, decisions: Record<string, Decision>) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<GroupMode>('space');
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [pass, setPass] = useState('');
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChosen = chosen.size === previews.length;
  const profiles = useMemo(() => new Set(previews.map((p) => p.arcProfile)).size, [previews]);

  return (
    <div className="stack">
      <p className="muted">
        Each Chrome profile has its own copy of Spaceport. Import the spaces that belong here, then do the same in your other
        profiles. Importing a space again replaces what it brought before.
      </p>
      <div className="row">
        <button className="btn btn-quiet" onClick={() => setChosen(allChosen ? new Set() : new Set(previews.map((p) => p.sourceId)))}>
          {allChosen ? 'Clear selection' : 'Select all'}
        </button>
      </div>
      <ul className="spaces" role="list">
        {previews.map((p) => (
          <li key={p.sourceId} className="space-row">
            <label className="space-pick">
              <input type="checkbox" checked={chosen.has(p.sourceId)} onChange={() => toggle(p.sourceId)} />
              <span className="swatch" style={{ background: groupColorVar(nearestGroupColor(p.color)) }} aria-hidden />
              <span className="space-name">{p.name}</span>
              <span className="muted">
                {p.pinned} pinned, {p.folders} folders{p.today ? `, ${p.today} today` : ''}
                {profiles > 1 && `, Arc profile ${p.arcProfile === 'default' ? '“Default”' : `“${p.arcProfile}”`}`}
              </span>
            </label>
            {p.status === 'replace' && <span className="note">Already imported; will be replaced</span>}
            {p.status === 'conflict' && (
              <label className="note">
                You edited this space here.{' '}
                <select value={decisions[p.sourceId] ?? 'keep'} onChange={(e) => setDecisions({ ...decisions, [p.sourceId]: e.target.value as Decision })}>
                  <option value="keep">Keep my edits</option>
                  <option value="replace">Replace with Arc’s version</option>
                  <option value="copy">Import as a copy</option>
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>

      <fieldset className="modes">
        <legend>Tab groups</legend>
        <label><input type="radio" name="mode" checked={mode === 'space'} onChange={() => setMode('space')} /> One group per space, opened from the sidebar as you go (recommended)</label>
        <label><input type="radio" name="mode" checked={mode === 'folder'} onChange={() => setMode('folder')} /> One group per folder, opened now in a new window</label>
        <p className="muted">Either way, every space is also saved as bookmarks named “Arc – …”, so your setup survives without Spaceport.</p>
      </fieldset>

      <div className="row">
        <button className="btn btn-primary" disabled={chosen.size === 0} onClick={() => onRun([...chosen], mode, decisions)}>
          Import {chosen.size || ''} {chosen.size === 1 ? 'space' : 'spaces'}
        </button>
      </div>

      <details className="safe-copy">
        <summary>Save a safe copy of all your Arc spaces</summary>
        <p className="muted">A file you keep in case Arc’s data disappears after it shuts down. Add a password if you will send it anywhere.</p>
        <div className="row">
          <input type="password" className="input" placeholder="Password (optional)" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn" onClick={async () => saveTextFile(`spaceport-${new Date().toISOString().slice(0, 10)}.json`, await encodeTransfer(setup, pass ? { passphrase: pass } : {}))}>
            Save copy
          </button>
        </div>
      </details>
    </div>
  );
}

function Summary({ report, undone, onUndo }: { report: ImportReport; undone?: boolean; onUndo: () => void }) {
  const [windowId, setWindowId] = useState<number>();
  useEffect(() => { browser.windows.getCurrent().then((w) => setWindowId(w.id)); }, []);
  const verbs = { added: 'Imported', replaced: 'Replaced', kept: 'Kept your edits to', copied: 'Imported a copy of' } as const;
  return (
    <div className="stack" role="status">
      <ul className="outcomes">
        {report.spaces.map((s) => <li key={s.name}>{verbs[s.outcome]} <strong>{s.name}</strong></li>)}
      </ul>
      <p className="muted">
        {report.bookmarksCreated} bookmarks saved{report.groupsCreated ? `, ${report.groupsCreated} tab groups with ${report.tabsOpened} tabs opened` : ''}.
      </p>
      {report.skipped.length > 0 && (
        <details>
          <summary>{report.skipped.length} items not imported</summary>
          <ul>{report.skipped.map((s, i) => <li key={i}>{s.title ?? 'Untitled'}: {s.reason}</li>)}</ul>
        </details>
      )}
      {report.failedUrls.length > 0 && (
        <details><summary>{report.failedUrls.length} links Chrome would not open (still in bookmarks)</summary><ul>{report.failedUrls.map((u) => <li key={u}>{u}</li>)}</ul></details>
      )}
      <div className="row">
        {windowId !== undefined && <button className="btn btn-primary" onClick={() => browser.sidePanel?.open({ windowId })}>Open the sidebar</button>}
        {report.undoAvailable && !undone && <button className="btn" onClick={onUndo}>Undo replacing spaces</button>}
        {undone && <span className="muted">Previous spaces restored in the sidebar. Bookmarks and tab groups from this import stay.</span>}
      </div>
    </div>
  );
}
