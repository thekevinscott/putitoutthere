/**
 * Decision core for the "Assert TestPyPI fixture artifacts exist" step.
 * I/O-free: lists `dist/` and guards that every fixture has both an sdist and a
 * wheel, then that they agree on a version the plan phase stamped for *this*
 * run (#672) — `skip-existing` lets a stale rebuild pass on a prior run's files.
 */

import { buildRequirements } from './build-requirements.js';
import { isPlanFixtureVersion } from './is-plan-fixture-version.js';
import { parseRequirement } from './parse-requirement.js';

const PREFIXES = ['piot_fixture_zzz_python_maturin', 'piot_fixture_zzz_python_hatch'] as const;

export interface AssertArtifactsDecision {
  lines: string[];
  exitCode: number;
}

export function decideAssertArtifacts(filenames: readonly string[]): AssertArtifactsDecision {
  const lines: string[] = filenames.map((name) => `dist/${name}`).sort();
  for (const prefix of PREFIXES) {
    if (!filenames.some((name) => name.startsWith(`${prefix}-`) && name.endsWith('.tar.gz'))) {
      lines.push(`::error::missing ${prefix} sdist artifact for TestPyPI`);
      return { lines, exitCode: 1 };
    }
    if (!filenames.some((name) => name.startsWith(`${prefix}-`) && name.endsWith('.whl'))) {
      lines.push(`::error::missing ${prefix} wheel artifact for TestPyPI`);
      return { lines, exitCode: 1 };
    }
  }
  // Reuse the metadata step's version collection rather than re-deriving
  // versions from filenames here, so the two steps can never disagree about
  // what version an artifact carries.
  const built = buildRequirements(filenames);
  if ('errorLine' in built) {
    lines.push(`::error::${built.errorLine}`);
    return { lines, exitCode: 1 };
  }
  for (const requirement of built.requirements) {
    const { package: pkg, version } = parseRequirement(requirement);
    if (!isPlanFixtureVersion(version)) {
      lines.push(
        `::error::${pkg} artifacts carry version ${version}, not the plan-computed 0.0.<epoch> version this run stamped — refusing to upload a stale build to TestPyPI (#672)`,
      );
      return { lines, exitCode: 1 };
    }
  }
  return { lines, exitCode: 0 };
}
