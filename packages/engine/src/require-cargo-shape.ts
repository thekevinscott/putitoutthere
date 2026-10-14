import type { CargoShapeOptions } from './cargo-shape-types.js';
import { checkCargoShape } from './check-cargo-shape.js';
import type { Package } from './config.js';

export async function requireCargoShape(
  packages: readonly Package[],
  options: CargoShapeOptions = {},
): Promise<void> {
  const findings = await checkCargoShape(packages, options);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    'Pre-flight Cargo.toml shape check failed:',
    '',
  ];
  for (const f of findings) {
    lines.push(`  [${f.code}] ${f.package}: ${f.cargoTomlPath}`);
    lines.push(`    ${f.detail}`);
  }
  lines.push(
    '',
    'Why: these mismatches would otherwise surface mid-`cargo build` or mid-`cargo',
    'publish` after the verification build has compiled the crate and every transitive',
    'dep — wasting the publish job on a precondition checkable in milliseconds.',
    'Fix the Cargo.toml + putitoutthere.toml fields in this list, then re-run.',
  );
  throw new Error(lines.join('\n'));
}
