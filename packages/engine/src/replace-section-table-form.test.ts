import { describe, expect, it } from 'vitest';

import { replaceSectionTableForm } from './replace-section-table-form.js';

describe('replaceSectionTableForm', () => {
  it('rewrites a section-table requirement and keeps sibling keys', () => {
    const out = replaceSectionTableForm(
      '[dependencies.demo-core]\npath = "../core"\nversion = "0.2"\nfeatures = ["cli"]\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe(
      '[dependencies.demo-core]\npath = "../core"\nversion = "0.4.2"\nfeatures = ["cli"]\n',
    );
  });

  it('leaves a section-table registry dependency alone', () => {
    const source = '[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["extension-module"]\n';
    expect(replaceSectionTableForm(source, 'pyo3', '0.4.2')).toBe(source);
  });

  it('rewrites a target-gated section table', () => {
    const out = replaceSectionTableForm(
      "[target.'cfg(unix)'.dependencies.demo-core]\npath = \"../core\"\nversion = \"0.2\"\n",
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe(
      "[target.'cfg(unix)'.dependencies.demo-core]\npath = \"../core\"\nversion = \"0.4.2\"\n",
    );
  });

  it('rewrites a section table that is not the first table in the file', () => {
    // The header is matched line-anchored; without multiline the pattern
    // would only ever match at the very start of the manifest.
    const out = replaceSectionTableForm(
      '[package]\nname = "host"\nversion = "9.9.9"\n\n[dependencies.demo-core]\npath = "../core"\nversion = "0.2"\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe(
      '[package]\nname = "host"\nversion = "9.9.9"\n\n[dependencies.demo-core]\npath = "../core"\nversion = "0.4.2"\n',
    );
  });

  it('rewrites every section-table occurrence, not just the first', () => {
    const out = replaceSectionTableForm(
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
    expect(out).not.toContain('version = "0.2"');
  });

  it('rewrites a section-table entry written without spaces', () => {
    const out = replaceSectionTableForm(
      '[dependencies.demo-core]\npath="../core"\nversion="0.2"\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe('[dependencies.demo-core]\npath="../core"\nversion="0.4.2"\n');
  });

  it('finds the requirement after a value containing a bracket', () => {
    // `features = ["cli"]` opens a `[` mid-section; treating it as the next
    // table header would end the section before `version` is reached.
    const out = replaceSectionTableForm(
      '[dependencies.demo-core]\npath = "../core"\nfeatures = ["cli"]\nversion = "0.2"\n',
      'demo-core',
      '0.4.2',
    );
    expect(out).toBe(
      '[dependencies.demo-core]\npath = "../core"\nfeatures = ["cli"]\nversion = "0.4.2"\n',
    );
  });

  it('stops a section table at the next table header', () => {
    const source = '[dependencies.demo-core]\npath = "../core"\n\n[dependencies.pyo3]\nversion = "0.22"\n';
    // demo-core declares no requirement of its own; pyo3's must not be taken
    // for it just because it is the next `version` line in the file.
    expect(replaceSectionTableForm(source, 'demo-core', '0.4.2')).toBe(source);
  });
});
