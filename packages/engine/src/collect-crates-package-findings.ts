import { join } from 'node:path';

import type { Package } from './config.js';
import {
  declaredFeatures,
  versionInheritsWorkspace,
  workspaceVersionDeclared,
  type CargoShapeFinding,
} from './preflight.js';
import { readToml } from './read-toml.js';

export async function collectCratesPackageFindings(
  p: Package & { kind: 'crates' },
  cwd: string,
  findings: CargoShapeFinding[],
): Promise<void> {
  const cargoTomlPath = join(p.path, 'Cargo.toml');
  const parsed = await readToml(cargoTomlPath);
  if (parsed === null) {return;}
  const pkgTable = (parsed.package ?? {}) as Record<string, unknown>;
  const expectedName = p.crate ?? p.name;

  // CRATES_NAME_MISMATCH
  if (typeof pkgTable.name === 'string' && pkgTable.name !== expectedName) {
    findings.push({
      package: p.name,
      cargoTomlPath,
      code: 'PIOT_CRATES_NAME_MISMATCH',
      detail: `[package].name = "${pkgTable.name}" but configured name is "${expectedName}"`,
    });
  }

  // CRATES_FEATURE_NOT_DECLARED — only when features is set on the
  // configured package.
  if (p.features !== undefined && p.features.length > 0) {
    const declared = declaredFeatures(parsed);
    const missing = p.features.filter((f) => !declared.has(f));
    if (missing.length > 0) {
      findings.push({
        package: p.name,
        cargoTomlPath,
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: `features = ${JSON.stringify(p.features)} references undeclared feature(s) ${JSON.stringify(missing)}; Cargo.toml [features] declares ${JSON.stringify([...declared])}`,
      });
    }
  }

  // CRATES_WORKSPACE_VERSION_MISMATCH
  if (versionInheritsWorkspace(pkgTable.version)) {
    if (!(await workspaceVersionDeclared(cargoTomlPath, cwd))) {
      findings.push({
        package: p.name,
        cargoTomlPath,
        code: 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH',
        detail:
          '[package].version.workspace = true but no ancestor Cargo.toml declares [workspace.package].version',
      });
    }
  }
}
