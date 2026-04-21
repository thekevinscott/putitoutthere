/**
 * Keyring — persistent storage for the user access token obtained
 * through `auth login`.
 *
 * Ships with a file-backed implementation (chmod 0600 in an XDG-
 * compliant config dir). The `Keyring` interface is the seam for
 * swapping in an OS keychain binding (e.g. `keytar`) later; see #105.
 *
 * Token values are never logged. Callers pass the whole `StoredAuth`
 * in and out; this module does not expose a "read just the access
 * token" affordance that could encourage stringification.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoredAuth {
  /** GitHub login of the account that approved the Device Flow. */
  account: string;
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  access_token_expires_at: number;
  /** Epoch seconds. */
  refresh_token_expires_at: number;
}

export interface Keyring {
  get(): Promise<StoredAuth | null>;
  set(auth: StoredAuth): Promise<void>;
  delete(): Promise<void>;
}

export interface FileKeyringOptions {
  /** Override the resolved config dir. Tests inject a tmp path. */
  dir?: string;
}

export function fileKeyring(opts: FileKeyringOptions = {}): Keyring {
  const dir = opts.dir ?? defaultConfigDir();
  const path = join(dir, 'auth.json');
  return {
    get(): Promise<StoredAuth | null> {
      if (!existsSync(path)) return Promise.resolve(null);
      const raw = readFileSync(path, 'utf8');
      return Promise.resolve(tryParse(raw));
    },
    set(auth: StoredAuth): Promise<void> {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      } else {
        // Best-effort tighten; harmless if we don't own the dir.
        try { chmodSync(dir, 0o700); } catch { /* ignore */ }
      }
      writeFileSync(path, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 });
      // writeFileSync honors `mode` only on create. Re-chmod to catch
      // the overwrite-an-existing-file case where the old mode sticks.
      chmodSync(path, 0o600);
      return Promise.resolve();
    },
    delete(): Promise<void> {
      if (existsSync(path)) rmSync(path);
      return Promise.resolve();
    },
  };
}

/** Returned for production callers. */
export function defaultKeyring(): Keyring {
  return fileKeyring();
}

function defaultConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, 'putitoutthere');
  return join(homedir(), '.config', 'putitoutthere');
}

function tryParse(raw: string): StoredAuth | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.account !== 'string' ||
    typeof o.access_token !== 'string' ||
    typeof o.refresh_token !== 'string' ||
    typeof o.access_token_expires_at !== 'number' ||
    typeof o.refresh_token_expires_at !== 'number'
  ) {
    return null;
  }
  return {
    account: o.account,
    access_token: o.access_token,
    refresh_token: o.refresh_token,
    access_token_expires_at: o.access_token_expires_at,
    refresh_token_expires_at: o.refresh_token_expires_at,
  };
}
