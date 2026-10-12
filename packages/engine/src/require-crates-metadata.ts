import { checkCratesMetadata } from './check-crates-metadata.js';
import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';

/**
 * Throw with an actionable error when any crates package's Cargo.toml
 * lacks a required `[package]` metadata field. Reports every failing
 * package + missing fields in one error rather than failing on the
 * first, so consumers fix them all in one round-trip.
 *
 * Why: crates.io's 400 lands after `cargo publish`'s verification
 * build has compiled the crate and every transitive dep — wasting
 * the entire publish job on a precondition checkable in milliseconds.
 * #290.
 */
export async function requireCratesMetadata(packages: readonly Package[]): Promise<void> {
  const findings = await checkCratesMetadata(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    `[${ErrorCodes.CRATES_MISSING_METADATA}] cargo publish requires the following Cargo.toml [package] fields: description, and license (or license-file).`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(
      `  - ${f.package}: ${f.cargoTomlPath} (missing: ${f.missing.join(', ')})`,
    );
  }
  lines.push(
    '',
    'Why: crates.io rejects publish with `400 Bad Request: missing or empty',
    'metadata fields: ...` after cargo publish has compiled the crate and every',
    'transitive dep — wasting the full publish job on a precondition checkable',
    'in milliseconds.',
    '',
    'Fix: add the missing fields to each Cargo.toml. Example:',
    '',
    '  [package]',
    '  description = "One-line summary of what the crate does."',
    '  license = "MIT OR Apache-2.0"',
    '',
    'See https://doc.rust-lang.org/cargo/reference/manifest.html#package-metadata.',
  );
  throw new Error(lines.join('\n'));
}
