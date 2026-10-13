import { checkPackageJsonShape } from './check-package-json-shape.js';
import type { Package } from './config.js';

// `npm publish` packs the `name` from package.json, but the engine's
// idempotency probe and tag/URL bookkeeping use the configured
// `[[package]].name` (or the `npm` override). The npm analogue of
// PIOT_PYPI_NAME_MISMATCH / PIOT_CRATES_NAME_MISMATCH (#301).
export async function requirePackageJsonShape(packages: readonly Package[]): Promise<void> {
  const findings = await checkPackageJsonShape(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    'Pre-flight package.json shape check failed:',
    '',
  ];
  for (const f of findings) {
    lines.push(`  [${f.code}] ${f.package}: ${f.packageJsonPath}`);
    lines.push(`    ${f.detail}`);
  }
  lines.push(
    '',
    'Why: `npm publish` packs the `name` from package.json, but the engine\'s',
    'idempotency probe (`npm view <name>`) and the tag/URL bookkeeping use the',
    'configured [[package]].name (or the `npm` override) — a divergence breaks',
    'idempotency and can publish under an unexpected name.',
    'Fix the package.json `name` or set the `npm` override in putitoutthere.toml, then re-run.',
  );
  throw new Error(lines.join('\n'));
}
