/**
 * Workflow YAML invariant checks. Catches the @v1-typo class of bug
 * (#243) without the trusted-publisher overhead of a live workflow
 * self-test (#244).
 *
 * Asserts:
 * - Every inner `uses: thekevinscott/putitoutthere*` ref pins `@v0`.
 * - Every external `uses:` ref pins a major (`@v4`, ...) or full SHA.
 * - Every `uses: ./...` local-path ref resolves to an existing file.
 * - The reusable workflow's path matches the README + CHANGELOG.
 *
 * Issue #246.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflowsDir = join(repoRoot, '.github/workflows');

interface UsesRef {
  workflow: string;
  line: number;
  ref: string;
}

function collectUses(): UsesRef[] {
  const out: UsesRef[] = [];
  for (const name of readdirSync(workflowsDir)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const text = readFileSync(join(workflowsDir, name), 'utf8');
    text.split('\n').forEach((raw, idx) => {
      if (raw.trimStart().startsWith('#')) return;
      const stripped = raw.replace(/\s+#.*$/, '');
      const m = stripped.match(/^\s*-?\s*uses:\s+['"]?([^'"\s]+)['"]?/);
      if (!m) return;
      out.push({ workflow: name, line: idx + 1, ref: m[1]! });
    });
  }
  return out;
}

const refs = collectUses();

describe('#246 workflow YAML invariants', () => {
  it('collects at least one uses ref (parser sanity)', () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it('every inner thekevinscott/putitoutthere ref pins @v0', () => {
    const inner = refs.filter((r) => r.ref.startsWith('thekevinscott/putitoutthere'));
    expect(inner.length).toBeGreaterThan(0);
    const bad = inner.filter(
      (r) => !/^thekevinscott\/putitoutthere(?:\/[^@]+)?@v0$/.test(r.ref),
    );
    expect(
      bad,
      `inner refs must pin @v0:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every external uses ref pins a major or full SHA', () => {
    const external = refs.filter(
      (r) =>
        r.ref.includes('/') &&
        !r.ref.startsWith('./') &&
        !r.ref.startsWith('thekevinscott/putitoutthere'),
    );
    expect(external.length).toBeGreaterThan(0);
    const bad = external.filter((r) => {
      const at = r.ref.lastIndexOf('@');
      if (at <= 0) return true;
      const tag = r.ref.slice(at + 1);
      return !/^v\d+(?:\.\d+){0,2}$/.test(tag) && !/^[0-9a-f]{40}$/.test(tag);
    });
    expect(
      bad,
      `external refs must pin a major (@vN) or full SHA:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every local-path uses ref resolves to a file in the repo', () => {
    const local = refs.filter((r) => r.ref.startsWith('./'));
    const bad = local.filter((r) => {
      const path = r.ref.split('@')[0]!;
      return !existsSync(join(repoRoot, path));
    });
    expect(
      bad,
      `local-path refs must point at an existing file:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('reusable workflow path matches README and CHANGELOG examples', () => {
    expect(existsSync(join(repoRoot, '.github/workflows/release.yml'))).toBe(true);
    const expected = 'thekevinscott/putitoutthere/.github/workflows/release.yml@v0';
    expect(readFileSync(join(repoRoot, 'README.md'), 'utf8')).toContain(expected);
    expect(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')).toContain(expected);
  });
});
