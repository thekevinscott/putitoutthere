import { isAbsolute, join, resolve } from 'node:path';

import type { Package } from './config.js';
import type { CargoShapeFinding } from './cargo-shape-types.js';
import { declaredFeatures } from './declared-features.js';
import { readDeclaredBinNames } from './read-declared-bin-names.js';
import { readToml } from './read-toml.js';

export async function collectBundleCliCrateFindings(
  p: Package & { kind: 'pypi' },
  bundleCli: NonNullable<(Package & { kind: 'pypi' })['bundle_cli']>,
  cwd: string,
  findings: CargoShapeFinding[],
): Promise<void> {
  const cratePathAbs = isAbsolute(bundleCli.crate_path)
    ? bundleCli.crate_path
    : resolve(cwd, bundleCli.crate_path);
  const cargoTomlPath = join(cratePathAbs, 'Cargo.toml');
  const parsed = await readToml(cargoTomlPath);
  if (parsed === null) {return;}

  // CRATES_MISSING_BIN
  const declaredBins = await readDeclaredBinNames(parsed, cargoTomlPath);
  if (!declaredBins.includes(bundleCli.bin)) {
    findings.push({
      package: p.name,
      cargoTomlPath,
      code: 'PIOT_CRATES_MISSING_BIN',
      detail: `bundle_cli.bin = "${bundleCli.bin}" is not declared as a [[bin]] in ${cargoTomlPath}; declared bins: ${declaredBins.length === 0 ? '(none)' : declaredBins.join(', ')}`,
    });
  }

  // CRATES_FEATURE_NOT_DECLARED — bundle_cli.features path
  if (bundleCli.features.length > 0) {
    const declared = declaredFeatures(parsed);
    const missing = bundleCli.features.filter((f) => !declared.has(f));
    if (missing.length > 0) {
      findings.push({
        package: p.name,
        cargoTomlPath,
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: `bundle_cli.features = ${JSON.stringify(bundleCli.features)} references undeclared feature(s) ${JSON.stringify(missing)}; Cargo.toml [features] declares ${JSON.stringify([...declared])}`,
      });
    }
  }
}
