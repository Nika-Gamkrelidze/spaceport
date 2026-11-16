// Spaceport's own model of an Arc setup (see GLOSSARY.md). Independent of Arc's file format.

export interface PinnedTab {
  kind: 'tab';
  id: string;
  url: string;
  /** The page title Arc last saw. */
  title: string;
  /** The name the person gave it in Arc, when different from the title. */
  customName?: string;
}

export interface Folder {
  kind: 'folder';
  id: string;
  name: string;
  children: Item[];
}

export interface SplitView {
  kind: 'split';
  id: string;
  tabs: PinnedTab[];
}

export interface Note {
  kind: 'note';
  id: string;
  title: string;
  documentId: string;
}

export type Item = PinnedTab | Folder | SplitView | Note;

export interface Rgb { r: number; g: number; b: number }

export interface Space {
  id: string;
  name: string;
  color?: Rgb;
  /** Arc profile the space belongs to: "default" or Arc's profile folder name. */
  arcProfile: string;
  pinned: Item[];
  today: PinnedTab[];
}

export interface Skipped {
  reason: string;
  title?: string;
}

export interface ArcSetup {
  spaces: Space[];
  /** Favorites per Arc profile key. */
  favorites: Record<string, PinnedTab[]>;
  skipped: Skipped[];
}

export type ParseResult = { ok: true; setup: ArcSetup } | { ok: false; error: string };
