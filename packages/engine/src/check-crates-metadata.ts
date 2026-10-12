import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { Package } from './config.js';
import { nonEmptyString, resolveInherited } from './preflight.js';
import { readWorkspacePackageTable } from './read-workspace-package-table.js';

/** A required Cargo.toml `[package]` field that crates.io enforces. */
export type CratesRequiredField = 'description' | 'license';

export interface CratesMetadataFinding {
  package: string;
  /** Pkg-relative `Cargo.toml` path examined. */
  cargoTomlPath: string;
  /** Required fields that are missing or empty. */
  missing: readonly CratesRequiredField[];
}

/**
 * Scan every crates package's `Cargo.toml` for the metadata crates.io
 * hard-requires at publish time: a non-empty `[package].description`, and
 * either `[package].license` or `[package].license-file`. Non-crates packages,
 * a missing `Cargo.toml` and malformed TOML are skipped.
 */
export async function checkCratesMetadata(
  packages: readonly Package[],
): Promise<CratesMetadataFinding[]> {
  const findings: CratesMetadataFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'crates') {continue;}
    const cargoTomlPath = join(p.path, 'Cargo.toml');
    let raw: string;
    try {
      raw = await readFile(cargoTomlPath, 'utf8');
    } catch {
      // The crates handler surfaces "Cargo.toml not found" with a
      // clear error; this check owns metadata fields, not file
      // existence. Skip.
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(raw);
    } catch {
      // Malformed TOML — cargo's own parser will surface it with a
      // useful diagnostic. Skip.
      continue;
    }
    const pkgTable = (parsed.package ?? {}) as Record<string, unknown>;
    // `[workspace.package]` inheritance (#328): cargo resolves
    // `license.workspace = true` against the workspace root before
    // upload, so the literal value lands on crates.io. The check has
    // to do the same — otherwise crates following Cargo's recommended
    // centralized-metadata pattern false-positive.
    const wsPkgTable = await readWorkspacePackageTable(p.path);
    const description = resolveInherited(pkgTable.description, wsPkgTable, 'description');
    const license = resolveInherited(pkgTable.license, wsPkgTable, 'license');
    const licenseFile = resolveInherited(
      pkgTable['license-file'],
      wsPkgTable,
      'license-file',
    );
    const missing: CratesRequiredField[] = [];
    if (!nonEmptyString(description)) {missing.push('description');}
    if (!nonEmptyString(license) && !nonEmptyString(licenseFile)) {
      missing.push('license');
    }
    if (missing.length > 0) {
      findings.push({ package: p.name, cargoTomlPath, missing });
    }
  }
  return findings;
}
