/**
 * Grammar for `reconcile --expect`: a single `<name>@<version>`, or a JSON
 * array of `{name, version, ...}` matching the release job's
 * `delegated_packages` output verbatim (extra keys, e.g. `tag`, are
 * ignored) — so `pypi-tag.yml` can forward that output without reshaping
 * it in YAML.
 *
 * Issue #666.
 */

import { toError } from './to-error.js';

export interface ExpectedPackage {
  name: string;
  version: string;
}

export function parseReconcileExpect(raw: string): ExpectedPackage[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    let parsed: unknown[];
    try {
      // A `[`-leading JSON document is an array by grammar, so a parse that
      // succeeds here cannot yield anything else.
      parsed = JSON.parse(trimmed) as unknown[];
    } catch (err) {
      throw new Error(
        `reconcile --expect: invalid JSON: ${toError(err).message}`,
        { cause: err },
      );
    }
    return parsed.map((entry, i) => {
      const name = (entry as Record<string, unknown> | null)?.name;
      const version = (entry as Record<string, unknown> | null)?.version;
      if (typeof name !== 'string' || typeof version !== 'string') {
        throw new Error(
          `reconcile --expect: entry ${i} is missing a string "name" or "version"`,
        );
      }
      return { name, version };
    });
  }
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    throw new Error(
      `reconcile --expect: expected "<name>@<version>" or a JSON array, got "${raw}"`,
    );
  }
  return [{ name: trimmed.slice(0, at), version: trimmed.slice(at + 1) }];
}
