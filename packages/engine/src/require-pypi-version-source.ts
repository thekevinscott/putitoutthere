import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import { checkPypiVersionSource } from './preflight.js';

/**
 * Throw with an actionable error when any pypi package's pyproject.toml
 * declares a static `[project].version` literal. Reports every failing
 * package in one error rather than failing on the first, so consumers
 * fix them all in one round-trip.
 *
 * The fix shape is the same across hatch-vcs, setuptools-scm, and
 * maturin: declare `dynamic = ["version"]` and let the build backend
 * derive the version from a tagged source (git tag,
 * `SETUPTOOLS_SCM_PRETEND_VERSION`, or sibling `Cargo.toml`).
 */
export async function requirePypiVersionSource(packages: readonly Package[]): Promise<void> {
  const findings = await checkPypiVersionSource(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    `[${ErrorCodes.PYPI_STATIC_VERSION}] pyproject.toml must declare \`[project].dynamic = ["version"]\` instead of a static \`[project].version = "..."\` literal.`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(`  - ${f.package}: ${f.pyprojectPath}`);
  }
  lines.push(
    '',
    'Why: putitoutthere does not edit pyproject.toml at release time (per the',
    '"no version computation" design commitment). A static literal silently',
    'ships the previous release\'s wheel/sdist, because the build backend reads',
    'whatever is on disk.',
    '',
    'Recommended fix (hatch-vcs):',
    '',
    '  [build-system]',
    '  requires = ["hatchling", "hatch-vcs"]',
    '  build-backend = "hatchling.build"',
    '',
    '  [project]',
    '  name = "<your-package>"',
    '  dynamic = ["version"]',
    '',
    '  [tool.hatch.version]',
    '  source = "vcs"',
    '',
    'setuptools-scm and the maturin (Cargo.toml-driven) path are equally',
    'valid — see https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions.',
  );
  throw new Error(lines.join('\n'));
}
