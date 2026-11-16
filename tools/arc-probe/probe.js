// Read-only: reports API availability and counts, line by line. Each call gets a timeout so a hanging API shows as HANG.
const out = [];
const el = document.getElementById('out');
const log = s => { out.push(s); el.textContent = out.join('\n'); };
const has = p => p.split('.').reduce((o, k) => o && o[k], globalThis) ? 'yes' : 'NO';
const timed = (name, p, ms = 3000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('HANG (no answer in ' + ms / 1000 + 's)')), ms))])
    .catch(e => { log(`${name}: ${e.message}`); return null; });

(async () => {
  el.textContent = '';
  log(`UA: ${navigator.userAgent}`);
  for (const a of ['chrome.tabs', 'chrome.tabGroups', 'chrome.bookmarks', 'chrome.sidePanel', 'chrome.windows', 'chrome.sessions'])
    log(`${a}: ${has(a)}`);

  const wins = await timed('windows.getAll', chrome.windows.getAll({}));
  if (wins) log(`windows: ${wins.length} [${wins.map(w => w.type).join(', ')}]`);

  const tabs = await timed('tabs.query', chrome.tabs.query({}));
  if (tabs) log(`tabs: ${tabs.length} in ${new Set(tabs.map(t => t.windowId)).size} windows; pinned=${tabs.filter(t => t.pinned).length}; grouped=${tabs.filter(t => t.groupId > -1).length}`);

  if (chrome.tabGroups) {
    const groups = await timed('tabGroups.query', chrome.tabGroups.query({}));
    if (groups) log(`tabGroups: ${groups.length} [${groups.map(g => g.title || '(untitled)').join(', ')}]`);
  }

  if (chrome.bookmarks) {
    const tree = await timed('bookmarks.getTree', chrome.bookmarks.getTree());
    if (tree) {
      const count = n => (n.url ? 1 : 0) + (n.children || []).reduce((s, c) => s + count(c), 0);
      for (const top of tree[0].children) log(`bookmarks "${top.title}": ${count(top)} urls; folders: [${(top.children || []).filter(c => !c.url).map(c => c.title).join(', ')}]`);
    }
  }
  log('done.');
})();
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(out.join('\n'));
