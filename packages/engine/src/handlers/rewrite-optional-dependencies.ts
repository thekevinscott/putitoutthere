import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { detectIndent } from './detect-indent.js';
import type { PlatformPkg } from './npm-platform.js';

export async function rewriteOptionalDependencies(
  pkg: PlatformPkg,
  version: string,
  platformPackages: readonly string[],
): Promise<void> {
  const p = join(pkg.path, 'package.json');
  const raw = await readFile(p, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const optionalDeps: Record<string, string> = {};
  for (const name of platformPackages) {
    optionalDeps[name] = version;
  }
  parsed.optionalDependencies = {
    ...((parsed.optionalDependencies) ?? {}),
    ...optionalDeps,
  };

  const indentArg = detectIndent(raw);
  const trailing = raw.endsWith('\n') ? '\n' : '';
  await writeFile(p, JSON.stringify(parsed, null, indentArg) + trailing, 'utf8');
}
