/**
 * Every fixture under `test/fixtures/` carries a
 * `.github/workflows/release.yml` snapshot of the canonical 5-line
 * consumer template (the one the README's Quickstart shows). This
 * test asserts every snapshot is byte-identical to that template.
 *
 * Why: the e2e harness in `.github/workflows/e2e-fixture.yml` runs
 * the same plan → build → publish job graph against each fixture
 * that the reusable workflow runs against a real consumer's tree.
 * For that to be a faithful test of the consumer experience, each
 * fixture has to be self-describing: opening
 * `test/fixtures/python-rust-maturin/` should show exactly what a
 * maturin consumer would write. If any fixture's workflow drifts
 * from the canonical template, this test fails — preventing the
 * fixtures from quietly becoming a parallel testing universe with
 * its own special-case YAML.
 *
 * This is a snapshot, not an executor. GitHub Actions parses
 * workflows from the trigger commit's repo root at workflow-load
 * time; a workflow living under `test/fixtures/...` is never
 * actually run by GitHub. Execution lives in
 * `.github/workflows/e2e-fixture.yml`. Issue #244.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixturesRoot = join(repoRoot, 'test/fixtures');

// The canonical 5-line consumer template. Mirrors the README Quickstart.
// If you change this, also update README.md.
const CANONICAL_TEMPLATE = `name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
    permissions:
      contents: write
      id-token: write
`;

function listFixtureDirs(): string[] {
  return readdirSync(fixturesRoot)
    .filter((name) => statSync(join(fixturesRoot, name)).isDirectory())
    .sort();
}

describe('#244 fixture consumer-template snapshots', () => {
  const fixtures = listFixtureDirs();

  it('finds at least one fixture (sanity)', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('%s/.github/workflows/release.yml matches canonical template', (fixture) => {
    const path = join(fixturesRoot, fixture, '.github/workflows/release.yml');
    // Normalize CRLF → LF: git on Windows defaults to autocrlf, so the
    // bytes on disk include \r\n even though the file is committed LF.
    // We compare logical content, not on-disk encoding.
    const actual = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    expect(actual).toBe(CANONICAL_TEMPLATE);
  });

  it('canonical template matches the README Quickstart block', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
    // The Quickstart shows the template inside a ```yaml fenced block.
    // We just need to confirm the body is present verbatim — the README
    // wraps it in fences which we strip from the search.
    expect(readme).toContain(CANONICAL_TEMPLATE.trimEnd());
  });
});
