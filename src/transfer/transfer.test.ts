import { describe, expect, it } from 'vitest';
import type { ArcSetup } from '../model';
import { decodeTransfer, encodeTransfer, KDF_ITERATIONS, validateSetup } from './transfer';

const setup: ArcSetup = {
  spaces: [{
    id: 's1', name: 'Work', color: { r: 1, g: 2, b: 3 }, arcProfile: 'default',
    pinned: [
      { kind: 'tab', id: 't1', url: 'https://a.example', title: 'A', customName: 'Mine' },
      { kind: 'folder', id: 'f1', name: 'F', children: [{ kind: 'note', id: 'n1', title: 'N', documentId: 'd1' }] },
      { kind: 'split', id: 'sp', tabs: [{ kind: 'tab', id: 't2', url: 'https://b.example', title: 'B' }] },
    ],
    today: [{ kind: 'tab', id: 't3', url: 'https://c.example', title: 'C' }],
  }],
  favorites: { default: [{ kind: 'tab', id: 't4', url: 'https://d.example', title: 'D' }] },
  skipped: [{ reason: 'Easel', title: 'E' }, { reason: 'x' }],
};
const fast = { iterations: 1000 };
const now = new Date('2026-11-16T10:00:00.000Z');

describe('transfer file', () => {
  it('defaults to 600000 PBKDF2 iterations', () => expect(KDF_ITERATIONS).toBe(600_000));

  it('round-trips a plain file', async () => {
    const text = await encodeTransfer(setup, { now });
    const env = JSON.parse(text);
    expect(env).toMatchObject({ format: 'spaceport-transfer', version: 1, createdAt: now.toISOString(), encrypted: false });
    expect(await decodeTransfer(text)).toEqual({ ok: true, setup, createdAt: now.toISOString() });
  });

  it('round-trips an encrypted file without leaking contents', async () => {
    const text = await encodeTransfer(setup, { passphrase: 'pw', now, ...fast });
    const env = JSON.parse(text);
    expect(env).toMatchObject({ encrypted: true, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 }, cipher: { name: 'AES-GCM' } });
    expect(env.setup).toBeUndefined();
    expect(text).not.toContain('a.example');
    expect(await decodeTransfer(text, 'pw')).toEqual({ ok: true, setup, createdAt: now.toISOString() });
  });

  it('uses the 600000 default when encrypting', async () => {
    const env = JSON.parse(await encodeTransfer({ spaces: [], favorites: {}, skipped: [] }, { passphrase: 'pw' }));
    expect(env.kdf.iterations).toBe(600_000);
  });

  it('uses fresh salt and IV each time', async () => {
    const a = JSON.parse(await encodeTransfer(setup, { passphrase: 'pw', ...fast }));
    const b = JSON.parse(await encodeTransfer(setup, { passphrase: 'pw', ...fast }));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(atob(a.kdf.salt)).toHaveLength(16);
    expect(atob(a.cipher.iv)).toHaveLength(12);
  });

  it('asks for a passphrase when missing', async () => {
    const text = await encodeTransfer(setup, { passphrase: 'pw', ...fast });
    const r = await decodeTransfer(text);
    expect(r).toMatchObject({ ok: false, needsPassphrase: true });
  });

  it('rejects a wrong passphrase cleanly', async () => {
    const text = await encodeTransfer(setup, { passphrase: 'pw', ...fast });
    const r = await decodeTransfer(text, 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/password|passphrase/i);
  });

  it('rejects tampered ciphertext', async () => {
    const env = JSON.parse(await encodeTransfer(setup, { passphrase: 'pw', ...fast }));
    const bytes = Uint8Array.from(atob(env.data), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 1;
    env.data = btoa(String.fromCharCode(...bytes));
    const r = await decodeTransfer(JSON.stringify(env), 'pw');
    expect(r.ok).toBe(false);
  });

  it('rejects absurd iteration counts from the file', async () => {
    const env = JSON.parse(await encodeTransfer(setup, { passphrase: 'pw', ...fast }));
    env.kdf.iterations = 1e12;
    expect((await decodeTransfer(JSON.stringify(env), 'pw')).ok).toBe(false);
  });

  it('rejects non-JSON, wrong format, future version and oversized input', async () => {
    expect((await decodeTransfer('not json')).ok).toBe(false);
    const wrong = await decodeTransfer(JSON.stringify({ format: 'other', version: 1 }));
    expect(wrong).toMatchObject({ ok: false });
    const future = await decodeTransfer(JSON.stringify({ format: 'spaceport-transfer', version: 2, encrypted: false, setup }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toMatch(/update Spaceport/i);
    const big = await decodeTransfer(' '.repeat(50 * 1024 * 1024 + 1));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/too large/i);
  });

  it('rejects an invalid setup inside a valid envelope', async () => {
    const text = JSON.stringify({ format: 'spaceport-transfer', version: 1, createdAt: now.toISOString(), encrypted: false, setup: { spaces: 'x' } });
    expect((await decodeTransfer(text)).ok).toBe(false);
  });
});

describe('validateSetup', () => {
  it('drops unknown properties', () => {
    const dirty = JSON.parse(JSON.stringify(setup));
    dirty.extra = 1;
    dirty.spaces[0].evil = '<script>';
    dirty.spaces[0].pinned[0].onclick = 'x';
    dirty.spaces[0].color.a = 9;
    dirty.skipped[0].more = true;
    expect(validateSetup(dirty)).toEqual(setup);
  });

  it('rejects a wrong item kind', () => {
    const bad = JSON.parse(JSON.stringify(setup));
    bad.spaces[0].pinned.push({ kind: 'easel', id: 'e' });
    expect(validateSetup(bad)).toBeNull();
  });

  it('rejects wrong field types', () => {
    const bad = JSON.parse(JSON.stringify(setup));
    bad.spaces[0].pinned[0].url = 42;
    expect(validateSetup(bad)).toBeNull();
    const bad2 = JSON.parse(JSON.stringify(setup));
    bad2.spaces[0].color.r = 'red';
    expect(validateSetup(bad2)).toBeNull();
  });

  it('rejects excessive nesting', () => {
    let item: any = { kind: 'tab', id: 't', url: 'https://x', title: 'x' };
    for (let i = 0; i < 70; i++) item = { kind: 'folder', id: `f${i}`, name: 'f', children: [item] };
    const bad = { spaces: [{ id: 's', name: 's', arcProfile: 'default', pinned: [item], today: [] }], favorites: {}, skipped: [] };
    expect(validateSetup(bad)).toBeNull();
  });

  it('rejects too many items', () => {
    const tab = { kind: 'tab', id: 't', url: 'https://x', title: 'x' };
    const bad = { spaces: [{ id: 's', name: 's', arcProfile: 'default', pinned: Array(200_001).fill(tab), today: [] }], favorites: {}, skipped: [] };
    expect(validateSetup(bad)).toBeNull();
  });
});
