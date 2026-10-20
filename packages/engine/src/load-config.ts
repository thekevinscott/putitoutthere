import { readFile } from 'node:fs/promises';

import { type Config, parseConfig } from './config.js';
import { toError } from './to-error.js';

export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(
      `putitoutthere.toml: cannot read ${path}: ${toError(err).message}`,
      { cause: err },
    );
  }
  return parseConfig(text);
}
