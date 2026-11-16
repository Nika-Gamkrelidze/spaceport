import type { ArcSetup, Item, PinnedTab, Rgb, Skipped, Space } from '../model';

// A transfer file arrives by email/USB, so decoding treats it as untrusted, like the Arc file (see src/arc/parse.ts).
export const KDF_ITERATIONS = 600_000;
const FORMAT = 'spaceport-transfer';
const VERSION = 1;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_ITEMS = 200_000;
// Iterations come from the file; cap them so a hostile file cannot hang the browser.
const MAX_ITERATIONS = 10_000_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

class Invalid extends Error {}
const need = <T>(ok: boolean, v: T): T => { if (!ok) throw new Invalid(); return v; };

/** Rebuilds a clean ArcSetup from untrusted data, keeping only known fields; null if anything is off. */
export function validateSetup(raw: unknown): ArcSetup | null {
  let count = 0;
  const counted = () => need(++count <= MAX_ITEMS, undefined);
  const s = (v: unknown) => need(isStr(v), v as string);
  const arr = (v: unknown) => need(Array.isArray(v), v as unknown[]);
  const obj = (v: unknown) => need(isObj(v), v as Obj);

  const tab = (v: unknown): PinnedTab => {
    const o = obj(v);
    need(o.kind === 'tab', 0);
    counted();
    return { kind: 'tab', id: s(o.id), url: s(o.url), title: s(o.title), ...(o.customName !== undefined ? { customName: s(o.customName) } : {}) };
  };
  const item = (v: unknown, depth: number): Item => {
    const o = obj(v);
    need(depth < MAX_DEPTH, 0);
    switch (o.kind) {
      case 'tab': return tab(o);
      case 'folder': counted(); return { kind: 'folder', id: s(o.id), name: s(o.name), children: arr(o.children).map((c) => item(c, depth + 1)) };
      case 'split': counted(); return { kind: 'split', id: s(o.id), tabs: arr(o.tabs).map(tab) };
      case 'note': counted(); return { kind: 'note', id: s(o.id), title: s(o.title), documentId: s(o.documentId) };
      default: throw new Invalid();
    }
  };
  const channel = (v: unknown) => need(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255, v as number);
  const rgb = (v: unknown): Rgb => { const o = obj(v); return { r: channel(o.r), g: channel(o.g), b: channel(o.b) }; };
  const space = (v: unknown): Space => {
    const o = obj(v);
    counted();
    return {
      id: s(o.id), name: s(o.name), ...(o.color !== undefined ? { color: rgb(o.color) } : {}),
      arcProfile: s(o.arcProfile), pinned: arr(o.pinned).map((c) => item(c, 0)), today: arr(o.today).map(tab),
    };
  };
  const skipped = (v: unknown): Skipped => {
    const o = obj(v);
    counted();
    return { reason: s(o.reason), ...(o.title !== undefined ? { title: s(o.title) } : {}) };
  };

  try {
    const o = obj(raw);
    // Object.fromEntries defines own properties, so a "__proto__" key cannot touch the prototype.
    const favorites = Object.fromEntries(Object.entries(obj(o.favorites)).map(([k, v]) => [k, arr(v).map(tab)]));
    return { spaces: arr(o.spaces).map(space), favorites, skipped: arr(o.skipped).map(skipped) };
  } catch (e) {
    if (e instanceof Invalid || e instanceof RangeError) return null;
    throw e;
  }
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(v: unknown): Uint8Array<ArrayBuffer> | null {
  if (!isStr(v)) return null;
  try { return Uint8Array.from(atob(v), (c) => c.charCodeAt(0)); } catch { return null; }
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** `iterations` is test-only, to keep tests fast; real callers leave it at KDF_ITERATIONS. */
export async function encodeTransfer(setup: ArcSetup, opts: { passphrase?: string; now?: Date; iterations?: number } = {}): Promise<string> {
  const head = { format: FORMAT, version: VERSION, createdAt: (opts.now ?? new Date()).toISOString() };
  if (!opts.passphrase) return JSON.stringify({ ...head, encrypted: false, setup });

  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(opts.passphrase, salt, iterations);
  const data = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(setup)));
  return JSON.stringify({
    ...head, encrypted: true,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(new Uint8Array(data)),
  });
}

export type DecodeResult = { ok: true; setup: ArcSetup; createdAt: string } | { ok: false; error: string; needsPassphrase?: boolean };

export async function decodeTransfer(text: string, passphrase?: string): Promise<DecodeResult> {
  const fail = (error: string): DecodeResult => ({ ok: false, error });
  if (text.length > MAX_BYTES) return fail('This file is too large to be a Spaceport transfer file (over 50 MB).');

  let env: unknown;
  try { env = JSON.parse(text); } catch { return fail('This file is not valid JSON, so it is not a Spaceport transfer file.'); }
  if (!isObj(env) || env.format !== FORMAT) return fail('This is not a Spaceport transfer file.');
  if (typeof env.version === 'number' && env.version > VERSION) return fail('This transfer file was made by a newer Spaceport. Update Spaceport, then try again.');
  if (env.version !== VERSION) return fail('This transfer file has an unknown version.');
  const createdAt = isStr(env.createdAt) ? env.createdAt : '';

  let raw: unknown;
  if (env.encrypted === false) {
    raw = env.setup;
  } else if (env.encrypted === true) {
    const kdf = isObj(env.kdf) ? env.kdf : {};
    const cipher = isObj(env.cipher) ? env.cipher : {};
    const salt = fromB64(kdf.salt), iv = fromB64(cipher.iv), data = fromB64(env.data);
    const it = kdf.iterations;
    if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher.name !== 'AES-GCM' || !salt || salt.length < 16 || !iv || iv.length !== 12 || !data
      || typeof it !== 'number' || !Number.isInteger(it) || it < 1 || it > MAX_ITERATIONS) {
      return fail('This transfer file is damaged (its encryption settings are invalid).');
    }
    if (!passphrase) return { ok: false, error: 'This transfer file is protected. Enter its password.', needsPassphrase: true };
    let plain: ArrayBuffer;
    try {
      plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await deriveKey(passphrase, salt, it), data);
    } catch {
      return fail('Wrong password, or the file was changed after it was saved.');
    }
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); } catch { return fail('This transfer file is damaged.'); }
  } else {
    return fail('This transfer file is damaged.');
  }

  const setup = validateSetup(raw);
  return setup ? { ok: true, setup, createdAt } : fail('This transfer file is damaged or contains data Spaceport does not understand.');
}
