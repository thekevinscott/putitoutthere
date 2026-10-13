import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { Package } from './config.js';
import { maturinIncludeCovers } from './maturin-include-covers.js';
import { classifyPypiVersionSource } from './pypi-version-source.js';

export type PypiShapeCode =
  | 'PIOT_PYPI_NAME_MISMATCH'
  | 'PIOT_PYPI_BUILD_BACKEND_MISMATCH'
  | 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND'
  | 'PIOT_PYPI_HATCH_VERSION_PATH'
  | 'PIOT_PYPI_MATURIN_INCLUDE_MISSING';

export interface PyprojectShapeFinding {
  package: string;
  pyprojectPath: string;
  code: PypiShapeCode;
  detail: string;
}

export async function checkPyprojectShape(
  packages: readonly Package[],
): Promise<PyprojectShapeFinding[]> {
  // Each PYPI_BUILD mode maps to the prefix(es) the upstream build
  // backend identifier should start with. The check is intentionally
  // loose: maturin / setuptools / hatchling all ship multiple backend
  // identifiers across versions, and the failure mode this gate exists
  // to catch is the *kind* mismatch (e.g. `build = "maturin"` but the
  // pyproject declares hatchling), not a backend-version drift.
  const backendPrefixes: Record<'maturin' | 'setuptools' | 'hatch', readonly string[]> = {
    maturin: ['maturin'],
    setuptools: ['setuptools'],
    hatch: ['hatchling', 'hatch'],
  };
  const findings: PyprojectShapeFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(await readFile(pyprojectPath, 'utf8'));
    } catch {
      // Missing or malformed pyproject.toml is a different failure
      // surface: the build tool reports it, and `check.ts` catches it
      // at PR time. Skip.
      continue;
    }

    const project = (parsed.project ?? {}) as Record<string, unknown>;
    const buildSystem = (parsed['build-system'] ?? {}) as Record<string, unknown>;
    const tool = (parsed.tool ?? {}) as Record<string, unknown>;
    const expectedName = p.pypi ?? p.name;

    if (typeof project.name === 'string' && project.name !== expectedName) {
      findings.push({
        package: p.name,
        pyprojectPath,
        code: 'PIOT_PYPI_NAME_MISMATCH',
        detail: `[project].name = "${project.name}" but configured name is "${expectedName}"`,
      });
    }

    // Only fires when the field is set *and* disagrees. A missing
    // [build-system] table is technically allowed (pip falls back to
    // setuptools); flagging it here would create noise on packages this
    // gate is not meant to police.
    const backend = buildSystem['build-backend'];
    if (typeof backend === 'string' && backend.length > 0) {
      const allowed = backendPrefixes[p.build];
      const ok = allowed.some((prefix) => backend.startsWith(prefix));
      if (!ok) {
        findings.push({
          package: p.name,
          pyprojectPath,
          code: 'PIOT_PYPI_BUILD_BACKEND_MISMATCH',
          detail: `[build-system].build-backend = "${backend}" but build = "${p.build}" expects ${allowed.map((a) => `"${a}*"`).join(' or ')}`,
        });
      }
    }

    // Only checks setuptools / hatch. Maturin sources its version from
    // Cargo.toml's [package].version when `dynamic = ["version"]` (and
    // `write-version` does bump that), so classifying its pyproject
    // would surface false positives on every maturin pypi package.
    //
    // The declared source has to be *reachable*, not merely present: a
    // version table whose plugin is missing from
    // `[build-system].requires`, or one that reads a literal off a file
    // nothing rewrites, both ship the previous release's version. The
    // decision lives in `classifyPypiVersionSource` (#696).
    if (p.build !== 'maturin') {
      const dynamic = project.dynamic;
      const dynamicHasVersion =
        Array.isArray(dynamic) && dynamic.some((v) => v === 'version');
      if (dynamicHasVersion) {
        const verdict = classifyPypiVersionSource(buildSystem, tool);
        if (!verdict.reachable) {
          findings.push({
            package: p.name,
            pyprojectPath,
            code: verdict.code,
            detail: verdict.detail,
          });
        }
      }
    }

    if (p.bundle_cli !== undefined) {
      const stageTo = p.bundle_cli.stage_to;
      const maturin = (tool.maturin ?? {}) as Record<string, unknown>;
      const include = maturin.include;
      if (!(Array.isArray(include) && maturinIncludeCovers(include, stageTo))) {
        findings.push({
          package: p.name,
          pyprojectPath,
          code: 'PIOT_PYPI_MATURIN_INCLUDE_MISSING',
          detail: `bundle_cli.stage_to = "${stageTo}" is not covered by any [tool.maturin].include entry; the cross-compiled binary will not be packed into the wheel`,
        });
      }
    }
  }
  return findings;
}
