# Spaceport — move from Arc

Arc stops working on **December 22, 2026**. Spaceport brings your Arc setup to Chrome, Edge, Brave and other Chromium browsers (Firefox coming next):

- **Spaces → any Chrome profile you choose.** Put each space in its own profile, or all of them in one.
- **Nested folders and pinned tabs, with the names you gave them.**
- **Native tab groups** plus a **bookmark copy** that keeps working even if you remove Spaceport.
- **An Arc-style sidebar**: spaces, folders, pinned tabs, Today and Favorites.

Free, open source, no account, no server, no tracking. Your data never leaves your browser.

> **Status:** in development — v1.0 is planned for the Chrome Web Store in early December 2026. ⭐ Star the repo to follow along.

## How it gets your Arc data

Spaceport reads Arc's sidebar file, which you pick yourself:

- **Mac:** `~/Library/Application Support/Arc/StorableSidebar.json` (press ⌘⇧G in the file dialog and paste the folder path)
- **Windows:** `%LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_ttt1ap7aakyb4\LocalCache\Local\Arc\StorableSidebar.json`

No Arc export step is needed. If you can't reach that file, Arc's own **Settings → Advanced → Export Data** works as a fallback.

**Export your Easels before December 22** (Arc → Library → Easels → Export All Easels): they live on Arc's servers, so no tool can recover them afterwards.

## Windows testers wanted

Arc on Windows stores its file a little differently. If you use Arc on Windows and can test a pre-release, please open an issue.

## Development

```bash
npm install
npm run dev        # Chrome with hot reload
npm test           # unit tests
npm run build      # production build (.output/chrome-mv3)
```

Design: [docs/DESIGN.md](docs/DESIGN.md) · Terms: [GLOSSARY.md](GLOSSARY.md) · Decisions: [docs/adr](docs/adr)

Never commit a real Arc file; tests use made-up data only (`npm run check:data` enforces this).

## Credits

Arc's file format was documented by open-source projects including [arc2dia2zen](https://github.com/fernando-bertholdo/arc2dia2zen), [notarc](https://github.com/Donnadieu/notarc) and [arc-export-windows](https://github.com/iamfitsum/arc-export-windows). Spaceport's code is its own.

Spaceport is not affiliated with or endorsed by The Browser Company. "Arc" is their trademark.

## License

[MIT](LICENSE)
