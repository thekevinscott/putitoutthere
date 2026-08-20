/**
 * Unit tests for `replaceDepVersionReq` (#621).
 *
 * Two properties are load-bearing. The requirement on a bumped path
 * dependency MUST move (otherwise cargo refuses to resolve and the build
 * dies at exit 101), and a registry dependency's requirement MUST NOT
 * (rewriting pyo3's `0.22` to the release version pins a version that does
 * not exist). Formatting is preserved byte-for-byte: the manifest belongs
 * to the consumer.
 */

import { describe, expect, it } from 'vitest';

import { replaceDepVersionReq } from './replace-dep-version-req.js';

describe('replaceDepVersionReq', () => {
  it('rewrites an inline-table requirement', () => {
    const out = replaceDepVersionReq(
      '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies]\ndemo-core = { path = "../core", version = "0.4.2" }\n');
  });

  it('rewrites a section-table requirement and keeps sibling keys', () => {
    const out = replaceDepVersionReq(
      '[dependencies.demo-core]\npath = "../core"\nversion = "0.2"\nfeatures = ["cli"]\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
    expect(out).toContain('features = ["cli"]');
    expect(out).toContain('path = "../core"');
  });

  it('rewrites the same dependency in every table it appears in', () => {
    const out = replaceDepVersionReq(
      [
        '[dependencies]',
        'demo-core = { path = "../core", version = "0.2" }',
        '[dev-dependencies]',
        'demo-core = { path = "../core", version = "0.2" }',
        '',
      ].join('\n'),
      'demo-core',
      '0.4.2',
    );
    expect(out.match(/version = "0\.4\.2"/g)).toHaveLength(2);
    expect(out).not.toContain('version = "0.2"');
  });

  it('leaves a registry dependency of the same name alone', () => {
    // No `path` key -- the entry resolves from crates.io, where the
    // release version does not exist.
    const source = '[dependencies]\npyo3 = { version = "0.22" }\n';
    expect(replaceDepVersionReq(source, 'pyo3', '0.4.2')).toBe(source);
  });

  it('leaves a section-table registry dependency alone', () => {
    const source = '[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["extension-module"]\n';
    expect(replaceDepVersionReq(source, 'pyo3', '0.4.2')).toBe(source);
  });

  it('is a no-op for a path dependency that declares no requirement', () => {
    const source = '[dependencies]\ndemo-core = { path = "../core" }\n';
    expect(replaceDepVersionReq(source, 'demo-core', '0.4.2')).toBe(source);
  });

  it('is a no-op when the key is absent', () => {
    const source = '[dependencies]\nother = { path = "../other", version = "0.2" }\n';
    expect(replaceDepVersionReq(source, 'demo-core', '0.4.2')).toBe(source);
  });

  it('does not let a nested table end the entry early', () => {
    const out = replaceDepVersionReq(
      '[dependencies]\ndemo-core = { path = "../core", features = ["a"], version = "0.2" }\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
    expect(out).toContain('features = ["a"]');
  });

  it('rewrites the multi-line inline-table form', () => {
    const out = replaceDepVersionReq(
      '[dependencies]\ndemo-core = {\n  path = "../core",\n  version = "0.2"\n}\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
    expect(out).toContain('path = "../core"');
  });

  it('rewrites a target-gated section table', () => {
    const out = replaceDepVersionReq(
      "[target.'cfg(unix)'.dependencies.demo-core]\npath = \"../core\"\nversion = \"0.2\"\n",
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
  });

  it('preserves comments and surrounding content byte-for-byte', () => {
    const source = [
      '[package]',
      'name = "host" # keep me',
      'version = "9.9.9"',
      '',
      '# a comment',
      '[dependencies]',
      'demo-core = { path = "../core", version = "0.2" }',
      '',
    ].join('\n');
    const out = replaceDepVersionReq(source, 'demo-core', '0.4.2');
    expect(out).toContain('name = "host" # keep me');
    expect(out).toContain('# a comment');
    // The package's own version is a different concern and must not move.
    expect(out).toContain('version = "9.9.9"');
  });

  it('escapes regex metacharacters in the key so it still matches', () => {
    // The key is interpolated into a RegExp. Stripping metacharacters
    // instead of escaping them would silently fail to match the entry.
    const out = replaceDepVersionReq(
      '[dependencies]\n"demo+core" = { path = "../core", version = "0.2" }\n',
      'demo+core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
  });

  it('rewrites a section table that is not the first table in the file', () => {
    // The header is matched line-anchored; without multiline the pattern
    // would only ever match at the very start of the manifest.
    const out = replaceDepVersionReq(
      '[package]\nname = "host"\nversion = "9.9.9"\n\n[dependencies.demo-core]\npath = "../core"\nversion = "0.2"\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
    expect(out).toContain('version = "9.9.9"');
  });

  it('rewrites every section-table occurrence, not just the first', () => {
    const out = replaceDepVersionReq(
      [
        '[dependencies.demo-core]',
        'path = "../core"',
        'version = "0.2"',
        '',
        '[dev-dependencies.demo-core]',
        'path = "../core"',
        'version = "0.2"',
        '',
      ].join('\n'),
      'demo-core',
      '0.4.2',
    );
    expect(out.match(/version = "0\.4\.2"/g)).toHaveLength(2);
  });

  it('treats the dependency key literally, not as a pattern', () => {
    const source = '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n';
    // `demo.core` must not match `demo-core` via a regex wildcard.
    expect(replaceDepVersionReq(source, 'demo.core', '0.4.2')).toBe(source);
  });

  it('leaves a truncated inline table untouched rather than corrupting it', () => {
    // An unterminated `{` has no closing brace to bound the entry. Leaving
    // it alone returns the manifest verbatim; guessing an end would rewrite
    // whatever followed, in a file the consumer owns.
    const source = '[dependencies]\ndemo-core = { path = "../core", version = "0.2"\n';
    expect(replaceDepVersionReq(source, 'demo-core', '0.4.2')).toBe(source);
  });

  it('rewrites an entry written without spaces around the separators', () => {
    // TOML does not require the spacing rustfmt happens to emit.
    const out = replaceDepVersionReq(
      '[dependencies]\ndemo-core={path="../core",version="0.2"}\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version="0.4.2"');
  });

  it('rewrites a section-table entry written without spaces', () => {
    const out = replaceDepVersionReq(
      '[dependencies.demo-core]\npath="../core"\nversion="0.2"\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version="0.4.2"');
  });

  it('finds the requirement after a value containing a bracket', () => {
    // `features = ["cli"]` opens a `[` mid-section; treating it as the next
    // table header would end the section before `version` is reached.
    const out = replaceDepVersionReq(
      '[dependencies.demo-core]\npath = "../core"\nfeatures = ["cli"]\nversion = "0.2"\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
  });

  it('stops a section table at the next table header', () => {
    const out = replaceDepVersionReq(
      '[dependencies.demo-core]\npath = "../core"\n\n[dependencies.pyo3]\nversion = "0.22"\n',
      'demo-core',
      '0.4.2',
    );
    // demo-core declares no requirement of its own; pyo3's must not be taken
    // for it just because it is the next `version` line in the file.
    expect(out).toContain('version = "0.22"');
    expect(out).not.toContain('0.4.2');
  });

  it('rewrites a quoted dependency key', () => {
    const out = replaceDepVersionReq(
      '[dependencies]\n"demo-core" = { path = "../core", version = "0.2" }\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toContain('version = "0.4.2"');
  });
});
