import { readFile } from 'node:fs/promises';

import { parse as parseToml } from 'smol-toml';

export async function parseCargoToml(path: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseToml(raw);
  } catch {
    return null;
  }
}
