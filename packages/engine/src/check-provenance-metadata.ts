import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Package } from './config.js';
import { hasNonEmptyRepository } from './has-non-empty-repository.js';

export interface ProvenanceFinding {
  package: string;
  /** Pkg-relative `package.json` path examined. */
  packageJsonPath: string;
  /** Why the field is unusable: missing entirely, or empty/no-url. */
  reason: 'missing' | 'empty';
}

/**
 * Scan every npm package's `package.json` for a non-empty `repository` field;
 * an empty finding list means all are well-formed. Both forms are accepted: the
 * canonical object (`{ type, url, directory? }`, needing a non-empty `url`) and
 * the legacy string (`"git+https://…"`, non-empty after trimming).
 */
export async function checkProvenanceMetadata(
  packages: readonly Package[],
): Promise<ProvenanceFinding[]> {
  const findings: ProvenanceFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'npm') {continue;}
    const pkgJsonPath = join(p.path, 'package.json');
    let raw: string;
    try {
      raw = await readFile(pkgJsonPath, 'utf8');
    } catch {
      findings.push({ package: p.name, packageJsonPath: pkgJsonPath, reason: 'missing' });
      continue;
    }
    let parsed: { repository?: unknown };
    try {
      parsed = JSON.parse(raw) as { repository?: unknown };
    } catch {
      // A malformed package.json is a different failure surface;
      // leave it to the publish step to bubble up. This check only
      // owns the `repository` field.
      continue;
    }
    if (!hasNonEmptyRepository(parsed.repository)) {
      findings.push({ package: p.name, packageJsonPath: pkgJsonPath, reason: 'empty' });
    }
  }
  return findings;
}
