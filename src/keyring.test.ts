import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileKeyring, type StoredAuth } from './keyring.js';

function mkAuth(overrides: Partial<StoredAuth> = {}): StoredAuth {
  return {
    account: 'octocat',
    access_token: 'ghu_test',
    refresh_token: 'ghr_test',
    access_token_expires_at: 2_000_000_000,
    refresh_token_expires_at: 2_500_000_000,
    ...overrides,
  };
}

describe('fileKeyring', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pot-keyring-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when no token has been stored', async () => {
    const k = fileKeyring({ dir });
    expect(await k.get()).toBeNull();
  });

  it('round-trips a stored token', async () => {
    const k = fileKeyring({ dir });
    const a = mkAuth();
    await k.set(a);
    expect(await k.get()).toEqual(a);
  });

  it('writes the file with mode 0600', async () => {
    const k = fileKeyring({ dir });
    await k.set(mkAuth());
    const st = statSync(join(dir, 'auth.json'));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('tightens file mode on overwrite', async () => {
    const path = join(dir, 'auth.json');
    writeFileSync(path, '{}', { mode: 0o644 });
    const k = fileKeyring({ dir });
    await k.set(mkAuth());
    const st = statSync(path);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('creates the dir if missing (nested)', async () => {
    const nested = join(dir, 'a', 'b');
    const k = fileKeyring({ dir: nested });
    await k.set(mkAuth());
    expect(existsSync(join(nested, 'auth.json'))).toBe(true);
  });

  it('delete() removes the file, is a no-op when nothing stored', async () => {
    const k = fileKeyring({ dir });
    await k.delete(); // no-op
    await k.set(mkAuth());
    expect(existsSync(join(dir, 'auth.json'))).toBe(true);
    await k.delete();
    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
  });

  it('returns null on malformed JSON', async () => {
    writeFileSync(join(dir, 'auth.json'), '{ not json ', 'utf8');
    const k = fileKeyring({ dir });
    expect(await k.get()).toBeNull();
  });

  it('returns null when the stored shape is missing a field', async () => {
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({ account: 'x', access_token: 'y' }),
      'utf8',
    );
    const k = fileKeyring({ dir });
    expect(await k.get()).toBeNull();
  });

  it('persists valid JSON shape on disk', async () => {
    const k = fileKeyring({ dir });
    await k.set(mkAuth({ account: 'alice' }));
    const raw = readFileSync(join(dir, 'auth.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.account).toBe('alice');
    expect(parsed.access_token).toBe('ghu_test');
  });
});
