import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { Package } from './config.js';

export interface PypiVersionFinding {
  package: string;
  /** Pkg-relative `pyproject.toml` path examined. */
  pyprojectPath: string;
}

/**
 * Scan every pypi package's `pyproject.toml` for a static `[project].version`
 * literal, which silently ships the previous release: the backend reads it at
 * build time and piot does not rewrite it (non-goal: version computation).
 * hatch-vcs / setuptools-scm / maturin all accept `dynamic = ["version"]`.
 */
export async function checkPypiVersionSource(
  packages: readonly Package[],
): Promise<PypiVersionFinding[]> {
  const findings: PypiVersionFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    let raw: string;
    try {
      raw = await readFile(pyprojectPath, 'utf8');
    } catch {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(raw);
    } catch {
      continue;
    }
    const project = parsed.project as
      | { version?: unknown; dynamic?: unknown }
      | undefined;
    if (project === undefined) {continue;}
    if (declaresDynamicVersion(project)) {continue;}
    if (typeof project.version === 'string') {
      findings.push({ package: p.name, pyprojectPath });
    }
  }
  return findings;
}

function declaresDynamicVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}
