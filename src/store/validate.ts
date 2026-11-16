import type { Library, StoredSpace } from './library';
import { validateSetup } from '../transfer/transfer';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rebuilds a clean Library from stored data, reusing the transfer file's strict setup validator. */
export function validateLibrary(raw: unknown): Library | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.spaces)) return null;
  const spaces: StoredSpace[] = [];
  for (const s of raw.spaces) {
    if (!isObj(s) || typeof s.sourceId !== 'string' || typeof s.importedHash !== 'string' || typeof s.importedAt !== 'string') return null;
    const space = validateSetup({ spaces: [s.space], favorites: {}, skipped: [] })?.spaces[0];
    if (!space) return null;
    spaces.push({ sourceId: s.sourceId, space, importedHash: s.importedHash, importedAt: s.importedAt });
  }
  const favorites = validateSetup({ spaces: [], favorites: raw.favorites ?? {}, skipped: [] })?.favorites;
  return favorites ? { version: 1, spaces, favorites } : null;
}
