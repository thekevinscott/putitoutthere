import { stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { Package } from '../config.js';
import { pathExists } from '../utils/path-exists.js';
import type { CheckFinding } from '../check.js';
import { readDeclaredBins } from './read-declared-bins.js';

export async function checkPyprojectAndBundleCli(
  packages: readonly Package[],
  cwd: string,
  findings: CheckFinding[],
): Promise<void> {
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    if (!(await pathExists(pyprojectPath))) {
      findings.push({
        package: p.name,
        message: `pyproject.toml not found at ${pyprojectPath}`,
      });
      continue;
    }
    if (p.build !== 'maturin' || p.bundle_cli === undefined) {continue;}
    const bundleCli = p.bundle_cli;
    // `bundle_cli.crate_path` is documented as relative to the repo
    // root (see config.ts: default = "."). Resolve against `cwd`,
    // not the package path.
    const cratePathAbs = isAbsolute(bundleCli.crate_path)
      ? bundleCli.crate_path
      : resolve(cwd, bundleCli.crate_path);
    const cargoTomlPath = join(cratePathAbs, 'Cargo.toml');
    if (!(await pathExists(cratePathAbs)) || !(await stat(cratePathAbs)).isDirectory()) {
      findings.push({
        package: p.name,
        message: `bundle_cli.crate_path "${bundleCli.crate_path}" does not exist or is not a directory`,
      });
      continue;
    }
    if (!(await pathExists(cargoTomlPath))) {
      findings.push({
        package: p.name,
        message: `bundle_cli.crate_path "${bundleCli.crate_path}" has no Cargo.toml`,
      });
      continue;
    }
    const declaredBins = await readDeclaredBins(cargoTomlPath);
    if (!declaredBins.includes(bundleCli.bin)) {
      findings.push({
        package: p.name,
        message: `bundle_cli.bin "${bundleCli.bin}" is not declared as a [[bin]] in ${cargoTomlPath}. Declared bins: ${declaredBins.length === 0 ? '(none)' : declaredBins.join(', ')}.`,
      });
    }
  }
}
