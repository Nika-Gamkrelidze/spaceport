# Read Arc's sidebar file; no extension inside Arc

Spaceport gets a person's spaces by having them pick Arc's sidebar file (`StorableSidebar.json`) in the destination browser, with Arc's own "Export Data" Markdown as a fallback. We do not ship a companion extension for Arc, and we do not pair two browsers through IDs, accounts or a server.

A read-only probe extension run inside Arc 1.173.1 (Chromium 157) on 2026-11-16 showed why: `tabs.query` returned only the 12 open tabs, with no pinned or group information; `tabGroups.query` never answered; `bookmarks` was empty; `sidePanel` and `sessions` were missing. Spaces, folders, pinned tabs and custom names exist only in the sidebar file, so an Arc-side extension could export at most the open tabs.

## Considered Options

- **Extension in Arc + pairing (random ID, Gmail, account):** cannot see the data (above), and pairing would need a backend, accounts and a privacy policy for browsing data.
- **Native messaging helper app:** could read the file without a picker, but needs a per-OS installer and widens the attack surface. Kept only as a last resort.

## Consequences

- The file picker must handle the hidden `~/Library` folder (plain file input with ⌘⇧G, plus drag-and-drop), not only the File System Access picker.
- The parser must be defensive: the format is undocumented and varies by version and OS.
