/**
 * `replaceCargoVersion` — the literal-only `[package].version` rewriter.
 *
 * The interesting cases are the ones where the `[package]` table ends: the
 * match must not escape it. Before #639 the expression was lazy and anchored
 * only on the header, so a manifest with no literal version had the match
 * land on whatever `version = "…"` came next — typically a dependency's
 * requirement — which it then rewrote, silently, reporting success.
 */

import { describe, expect, it } from 'vitest';

import { replaceCargoVersion } from './replace-cargo-version.js';

describe('replaceCargoVersion', () => {
  it('rewrites the literal [package].version', () => {
    const out = replaceCargoVersion('[package]\nname = "demo"\nversion = "0.1.0"\n', '0.4.2');
    expect(out).toBe('[package]\nname = "demo"\nversion = "0.4.2"\n');
  });

  it('preserves surrounding comments and whitespace byte-for-byte', () => {
    const src = '[package]\nname    = "demo"\n# keep me\nversion = "0.1.0"   # trailing\n';
    expect(replaceCargoVersion(src, '0.4.2')).toBe(
      '[package]\nname    = "demo"\n# keep me\nversion = "0.4.2"   # trailing\n',
    );
  });

  it('returns the source unchanged when the version already matches', () => {
    const src = '[package]\nversion = "1.0.0"\n';
    expect(replaceCargoVersion(src, '1.0.0')).toBe(src);
  });

  it('rewrites an indented version line', () => {
    // Indentation is legal TOML and appears in hand-formatted manifests. A
    // pattern that cannot cross leading whitespace would report the field
    // missing and abort the release on a perfectly valid file.
    expect(replaceCargoVersion('[package]\n  version = "0.1.0"\n', '0.4.2')).toBe(
      '[package]\n  version = "0.4.2"\n',
    );
  });

  it('rewrites a version line with no spaces around the `=`', () => {
    // `version="0.1.0"` is the same assignment to TOML; spacing is the
    // author's choice, not part of the grammar.
    expect(replaceCargoVersion('[package]\nversion="0.1.0"\n', '0.4.2')).toBe(
      '[package]\nversion="0.4.2"\n',
    );
  });

  it('rewrites a version line with extra spaces around the `=`', () => {
    expect(replaceCargoVersion('[package]\nversion  =  "0.1.0"\n', '0.4.2')).toBe(
      '[package]\nversion  =  "0.4.2"\n',
    );
  });

  it('finds the table when its header line carries a trailing comment', () => {
    // `[package]   # crate metadata` is still the table header; a pattern
    // that demanded a newline immediately after `]` would miss it entirely.
    expect(
      replaceCargoVersion('[package]   # crate metadata\nversion = "0.1.0"\n', '0.4.2'),
    ).toBe('[package]   # crate metadata\nversion = "0.4.2"\n');
  });

  it('ignores a `[package]` mentioned in a comment before the real table', () => {
    // Unanchored, the match would start inside the comment and its body
    // would end at the real header — reporting the version missing on a file
    // that plainly has one.
    const src = '# see the [package] table below\n[package]\nversion = "0.1.0"\n';
    expect(replaceCargoVersion(src, '0.4.2')).toBe(
      '# see the [package] table below\n[package]\nversion = "0.4.2"\n',
    );
  });

  it('ignores a `version = "..."` inside a comment above the real assignment', () => {
    // The comment is not an assignment. Rewriting it would leave the crate's
    // actual version untouched while editing prose — the #639 failure mode in
    // miniature.
    const src = '[package]\n# version = "9.9.9" once we ship\nversion = "0.1.0"\n';
    expect(replaceCargoVersion(src, '0.4.2')).toBe(
      '[package]\n# version = "9.9.9" once we ship\nversion = "0.4.2"\n',
    );
  });

  it('refuses a manifest that inherits its version instead of rewriting a dependency', () => {
    // #639. The `[package]` table has no literal version; the next
    // `version = "…"` in the file is pyo3's requirement. Rewriting that
    // names a pyo3 release that does not exist, so the only safe answer is
    // to fail loud — callers that must handle inheritance go through
    // `writeResolvedCargoVersion`.
    const src =
      '[package]\nname = "demo"\nversion.workspace = true\nedition = "2021"\n\n' +
      '[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["extension-module"]\n';
    expect(() => replaceCargoVersion(src, '0.4.2')).toThrow(/no \[package\]\.version/);
  });

  it('does not reach past the table into an inline dependency table either', () => {
    const src = '[package]\nname = "demo"\nversion.workspace = true\n\n[dependencies]\nserde = { version = "1" }\n';
    expect(() => replaceCargoVersion(src, '0.4.2')).toThrow(/no \[package\]\.version/);
  });

  it('rewrites the package version and leaves a later dependency requirement alone', () => {
    const src =
      '[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies.pyo3]\nversion = "0.22"\n';
    const out = replaceCargoVersion(src, '0.4.2');
    expect(out).toContain('version = "0.4.2"');
    expect(out).toContain('version = "0.22"');
  });

  it('throws when there is no [package] table at all', () => {
    expect(() => replaceCargoVersion('[workspace]\nmembers = ["a"]\n', '0.4.2')).toThrow(
      /no \[package\]\.version/,
    );
  });

  it('handles a [package] table that is the whole file, with no trailing newline', () => {
    // The table body regex has to accept a final line terminated by EOF
    // rather than `\n`, or the last assignment falls outside the match.
    expect(replaceCargoVersion('[package]\nversion = "0.1.0"', '0.4.2')).toBe(
      '[package]\nversion = "0.4.2"',
    );
  });
});
