/**
 * Every fixture's `.github/workflows/release.yml` must be byte-identical to the
 * canonical consumer template (#244), so fixtures can't become a parallel YAML
 * universe. Snapshots, not executors: GitHub loads workflows from the repo root,
 * so one under `tests/fixtures/` never runs — execution is `e2e-fixture.yml`'s.
 * The template's conditional `pypi-publish` job exists for warehouse#11096.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixturesRoot = join(packageRoot, 'tests/fixtures');
// README.md stays at the repo root, two levels above this engine package.
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

// The canonical consumer template. Mirrors the README Quickstart.
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

  # PyPI upload runs in the caller's workflow context. Required because
  # PyPI Trusted Publishers can't validate OIDC tokens minted from a
  # cross-repo reusable workflow (pypi/warehouse#11096). The \`if:\`
  # gate skips this job for non-PyPI repos — paste verbatim regardless
  # of what you publish. \`pypi_pending\` is only 'true' when the release
  # job actually handed this job an upload, and \`!cancelled()\` lets that
  # upload proceed even if the release job failed on some other registry.
  pypi-publish:
    needs: release
    if: \${{ !cancelled() && needs.release.outputs.pypi_pending == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          pattern: '*-sdist'
          path: dist/
          merge-multiple: true
      - uses: actions/download-artifact@v8
        with:
          pattern: '*-wheel-*'
          path: dist/
          merge-multiple: true
      - uses: pypa/gh-action-pypi-publish@release/v1

  # Cuts the git tag for what the job above just uploaded. The release
  # job deliberately does not tag a PyPI package: a tag records what
  # shipped, and until this upload lands, nothing has. Paste verbatim.
  pypi-tag:
    needs: pypi-publish
    uses: thekevinscott/putitoutthere/.github/workflows/pypi-tag.yml@v0
    permissions:
      contents: write
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
