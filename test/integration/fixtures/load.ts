/**
 * Helper for loading registry-response fixtures. Tests grep for these by
 * (category, name) pair rather than hard-coding paths so the catalog at
 * `notes/upstream-behaviors.md` stays the single source of truth for which
 * fixtures exist.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', 'registry-responses');

export type FixtureCategory = 'crates-io' | 'npm' | 'pypi';

export function loadFixture(category: FixtureCategory, name: string): string {
  return readFileSync(join(ROOT, category, name), 'utf8');
}
