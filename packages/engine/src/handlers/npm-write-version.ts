import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Ctx } from '../types.js';
import { toError } from '../to-error.js';
import { detectIndent } from './detect-indent.js';
import type { NpmPkg } from './npm-name-for.js';

export async function npmWriteVersion(pkg: NpmPkg, version: string, _ctx: Ctx): Promise<string[]> {
  const p = join(pkg.path, 'package.json');
  let original: string;
  try {
    original = await readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`package.json not found at ${p}`, { cause: err });
    }
    throw toError(err);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(original) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `package.json JSON parse error: ${toError(err).message}`,
      { cause: err },
    );
  }
  if (parsed.version === version) {return [];}
  parsed.version = version;
  // Preserve the existing indentation shape (2-space default if we
  // can't detect) and the trailing newline when present.
  const indent = detectIndent(original);
  const trailing = original.endsWith('\n') ? '\n' : '';
  await writeFile(p, JSON.stringify(parsed, null, indent) + trailing, 'utf8');
  return [p];
}
