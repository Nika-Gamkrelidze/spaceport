# Spaceport — design summary

Spaceport moves a person's Arc setup into Chromium browsers (and Firefox next) and gives them an Arc-style sidebar there. Terms are defined in [GLOSSARY.md](../GLOSSARY.md); hard-to-reverse decisions live in [docs/adr](./adr).

## Product
- **One extension, two parts:** import (Arc → native tab groups + bookmark copy) and the sidebar (spaces > nested folders > pinned tabs with custom names, Today, Favorites).
- **Free, MIT, no backend, no accounts, no tracking.** Data stays in the browser (local storage). Bug reports: a "Report a problem" button opens a pre-filled GitHub issue with counts and versions only.
- **Name:** Spaceport — store title "Spaceport — Move from Arc: Spaces, Folders & Tabs". Original visual identity; Arc-familiar behaviour. Not affiliated with The Browser Company.

## Getting Arc data (ADR 0001)
- No extension inside Arc (probe proved it can't see spaces). Sources, best first:
  1. **Arc sidebar file** picked by the user (plain file input with ⌘⇧G tip, drag-and-drop; Chrome's newer picker only as an extra).
  2. **Arc Data Export** Markdown (Settings → Advanced → Export Data) — guided fallback.
  3. **Transfer file** from another Spaceport install (optional password, browser-native encryption).
- First run offers a **safe copy** while Arc still works (shutdown Dec 22, 2026); parser can fall back to Arc's newest valid automatic backup.

## Import
- Chosen **per destination profile**; any subset of spaces; all spaces in one profile also works. Picker shows each space's Arc profile.
- Writes the **bookmark copy** every time (survives uninstall, keeps names, works on failing pages).
- Native groups: **space group** (default with sidebar) or **folder group** (import-only users).
- Today tabs listed in the sidebar, not opened; auto-archive after Arc's default 12 h (adjustable).
- Favorites of the matching Arc profile come along (sidebar row + bookmark folder).
- Split View → native split on Chrome 155+, else adjacent tabs. Notes (experimental, + Markdown files) and Archive (searchable list). Easels/Boosts can't be imported — warn to export Easels before Dec 22. Little Arc skipped.
- Re-import of an edited space asks **Replace / Keep mine / Import as copy**, auto-saving a transfer file before replacing.

## Safety
- Arc file treated as untrusted: 50 MB cap, depth/count limits, full validation before any write, unknown kinds reported and skipped, names rendered as text only.
- Only http/https are opened; `javascript:`, `file://`, `chrome://`, `data:` go to the bookmark copy only; malformed entries listed in the summary.
- Install permissions: tabs, tabGroups, bookmarks, storage, sidePanel. Site access (tab-title renaming) is opt-in via optional permissions.
- No remote code; reimplement rather than copy competitor code; credit format notes in the README.

## Sidebar behaviour
- Click a pinned tab: switch to it if open, else open it in its space group; "back to pinned page" when navigated away; closing the tab keeps the pinned item.
- Drag to reorder, inline rename, delete with undo. Space switching collapses other space groups.
- Shortcuts: ⌘/Ctrl+Shift+1…9 spaces, ⌘/Ctrl+Shift+F search, open-sidebar shortcut (rebindable). Keyboard + screen-reader accessible, WCAG AA contrast, light/dark with system.

## Build & release
- WXT + TypeScript + React; unit tests for the parser (synthetic fixtures incl. broken/old/Windows formats), browser tests for import and sidebar; GitHub Actions on every push (tests, Chrome + Firefox builds, real-Arc-file guard). Store uploads manual.
- Repo: public `github.com/Nika-Gamkrelidze/spaceport`. Privacy policy on `nika-gamkrelidze.github.io/spaceport`. Firefox ID `spaceport@nika-gamkrelidze.github.io`.
- **v1.0 — submit by Dec 1:** import (3 sources), space/folder groups, bookmark copy, safe copy, transfer file, sidebar (spaces, folders, pinned tabs, Today, custom names, Favorites). Chrome Web Store + Edge Add-ons.
- **v1.1 — December:** Notes, Archive, Split View, opt-in tab-title renaming.
- **v1.2 — January:** Firefox (sidebar_action entry point, tabGroups 139+, AMO with source + "no data collected").
- Windows: synthetic fixtures + public beta testers; VM only if bugs appear.
