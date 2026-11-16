# Spaceport

Moves a person's Arc browser setup (spaces, folders and pinned tabs, with their custom names) into Chromium browsers, and later recreates the Arc-style sidebar there.

## Arc concepts

**Space**:
A named, colored workspace in Arc holding its own folders, pinned tabs and today tabs.
_Avoid_: Workspace, profile, tab group

**Folder**:
A named container inside a space that holds pinned tabs and other folders, nested to any depth.
_Avoid_: Group, list

**Pinned Tab**:
A saved item in a space: a URL with an optional custom name, kept until the person removes it.
_Avoid_: Link, bookmark, saved link

**Today Tab**:
An unpinned item in a space that Arc archives automatically after a while.
_Avoid_: Unpinned tab, temporary tab

**Favorite**:
A pinned tab shown above the spaces, shared by every space that uses the same Arc profile.
_Avoid_: Top app, global pin

**Custom Name**:
The name a person gave a pinned tab in Arc, shown instead of the page's own title.
_Avoid_: Alias, label, rename

**Split View**:
One sidebar item that shows two or more pages side by side.
_Avoid_: Split tab, tile

**Note**:
A text document kept in a space's sidebar alongside its pinned tabs.
_Avoid_: Arc document, memo

**Archive**:
The list of today tabs and pinned tabs that were closed, kept so they can be found and reopened.
_Avoid_: History, trash

**Arc Sidebar File**:
The file on the person's computer in which Arc keeps all spaces, folders and pinned tabs.
_Avoid_: Arc export, Arc backup

**Arc Data Export**:
The Markdown list of links per space that Arc's own Export Data setting produces; a fallback import source with less detail than the arc sidebar file.
_Avoid_: Export file, Markdown backup

## Destination concepts

**Tab**:
A live, open tab in the destination browser.
_Avoid_: Pinned tab (that is the saved Arc item)

**Sidebar**:
Spaceport's own panel that shows spaces, folders, pinned tabs, today tabs and notes with their custom names.
_Avoid_: Side panel (the browser's container for it), tab strip

**Space Group**:
The one native tab group that holds a space's open tabs while the sidebar is in use.
_Avoid_: Folder group

**Folder Group**:
A native tab group made from one folder, for people who import without using the sidebar.
_Avoid_: Space group

**Bookmark Copy**:
The bookmark folders every import writes, mirroring each space with its custom names, so the setup survives without Spaceport.
_Avoid_: Backup, export

**Safe Copy**:
A transfer file Spaceport offers to save on first run, while Arc still works.
_Avoid_: Backup, snapshot

**Destination Profile**:
One browser profile that receives some or all spaces; each has its own copy of the extension.
_Avoid_: Account, target

**Import**:
Bringing chosen spaces from an Arc sidebar file or transfer file into one destination profile; repeating it replaces what it brought before.
_Avoid_: Sync, restore

**Transfer File**:
A file the extension writes so a person can carry their spaces to another computer themselves.
_Avoid_: Backup, export (alone), sync file
