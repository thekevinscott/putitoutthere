import { describe, expect, it } from 'vitest';

import { replaceInlineTableForm } from './replace-inline-table-form.js';

describe('replaceInlineTableForm', () => {
  it('rewrites an inline-table requirement', () => {
    const out = replaceInlineTableForm(
      '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies]\ndemo-core = { path = "../core", version = "0.4.2" }\n');
  });

  it('rewrites the same dependency in every table it appears in', () => {
    const out = replaceInlineTableForm(
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
    expect(replaceInlineTableForm(source, 'pyo3', '0.4.2')).toBe(source);
  });

  it('is a no-op for a path dependency that declares no requirement', () => {
    const source = '[dependencies]\ndemo-core = { path = "../core" }\n';
    expect(replaceInlineTableForm(source, 'demo-core', '0.4.2')).toBe(source);
  });

  it('is a no-op when the key is absent', () => {
    const source = '[dependencies]\nother = { path = "../other", version = "0.2" }\n';
    expect(replaceInlineTableForm(source, 'demo-core', '0.4.2')).toBe(source);
  });

  it('does not let a nested table end the entry early', () => {
    const out = replaceInlineTableForm(
      '[dependencies]\ndemo-core = { path = "../core", features = ["a"], version = "0.2" }\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe(
      '[dependencies]\ndemo-core = { path = "../core", features = ["a"], version = "0.4.2" }\n',
    );
  });

  it('rewrites the multi-line inline-table form', () => {
    const out = replaceInlineTableForm(
      '[dependencies]\ndemo-core = {\n  path = "../core",\n  version = "0.2"\n}\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies]\ndemo-core = {\n  path = "../core",\n  version = "0.4.2"\n}\n');
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
    const out = replaceInlineTableForm(source, 'demo-core', '0.4.2');
    // The package's own version is a different concern and must not move.
    expect(out).toBe(source.replace('version = "0.2"', 'version = "0.4.2"'));
  });

  it('leaves a truncated inline table untouched rather than corrupting it', () => {
    // An unterminated `{` has no closing brace to bound the entry. Leaving
    // it alone returns the manifest verbatim; guessing an end would rewrite
    // whatever followed, in a file the consumer owns.
    const source = '[dependencies]\ndemo-core = { path = "../core", version = "0.2"\n';
    expect(replaceInlineTableForm(source, 'demo-core', '0.4.2')).toBe(source);
  });

  it('rewrites an entry written without spaces around the separators', () => {
    // TOML does not require the spacing rustfmt happens to emit.
    const out = replaceInlineTableForm(
      '[dependencies]\ndemo-core={path="../core",version="0.2"}\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies]\ndemo-core={path="../core",version="0.4.2"}\n');
  });

  it('rewrites a quoted dependency key', () => {
    const out = replaceInlineTableForm(
      '[dependencies]\n"demo-core" = { path = "../core", version = "0.2" }\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies]\n"demo-core" = { path = "../core", version = "0.4.2" }\n');
  });

  it('matches the key as the pattern it is given', () => {
    const out = replaceInlineTableForm(
      '[dependencies]\n"demo+core" = { path = "../core", version = "0.2" }\n',
      'demo\\+core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies]\n"demo+core" = { path = "../core", version = "0.4.2" }\n');
  });
});
