import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Package } from './config.js';

export type NpmShapeCode = 'PIOT_NPM_NAME_MISMATCH';

export interface PackageJsonShapeFinding {
  package: string;
  packageJsonPath: string;
  code: NpmShapeCode;
  detail: string;
}

export async function checkPackageJsonShape(
  packages: readonly Package[],
): Promise<PackageJsonShapeFinding[]> {
  const findings: PackageJsonShapeFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'npm') {continue;}
    const packageJsonPath = join(p.path, 'package.json');
    let raw: string;
    try {
      raw = await readFile(packageJsonPath, 'utf8');
    } catch {
      // Missing package.json is a different failure surface:
      // `checkProvenanceMetadata` reports it, and `check.ts` surfaces it
      // at PR time. Skip.
      continue;
    }
    let parsed: { name?: unknown };
    try {
      parsed = JSON.parse(raw) as { name?: unknown };
    } catch {
      // Malformed package.json — let the publish step surface its own
      // diagnostic. This check only owns the `name` field.
      continue;
    }
    const expectedName = p.npm ?? p.name;
    if (typeof parsed.name === 'string' && parsed.name !== expectedName) {
      findings.push({
        package: p.name,
        packageJsonPath,
        code: 'PIOT_NPM_NAME_MISMATCH',
        detail: `name = "${parsed.name}" but configured name is "${expectedName}"`,
      });
    }
  }
  return findings;
}
