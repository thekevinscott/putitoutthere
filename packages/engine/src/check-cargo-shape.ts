import type { CargoShapeFinding, CargoShapeOptions } from './cargo-shape-types.js';
import { collectBundleCliCrateFindings } from './collect-bundle-cli-crate-findings.js';
import { collectCratesPackageFindings } from './collect-crates-package-findings.js';
import type { Package } from './config.js';

export async function checkCargoShape(
  packages: readonly Package[],
  options: CargoShapeOptions = {},
): Promise<CargoShapeFinding[]> {
  const findings: CargoShapeFinding[] = [];
  const cwd = options.cwd ?? process.cwd();
  for (const p of packages) {
    if (p.kind === 'crates') {
      await collectCratesPackageFindings(p, cwd, findings);
    } else if (p.kind === 'pypi' && p.bundle_cli !== undefined) {
      await collectBundleCliCrateFindings(p, p.bundle_cli, cwd, findings);
    }
  }
  return findings;
}
