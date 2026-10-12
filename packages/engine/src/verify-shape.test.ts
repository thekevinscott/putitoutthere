import { describe, expect, it } from 'vitest';

import type { MatrixRow } from './completeness.js';
import { verifyShape } from './verify-shape.js';

function row(over: Partial<MatrixRow>): MatrixRow {
  return { name: 'demo', kind: 'crates', version: '0.1.0', target: 'noarch', artifact_name: 'demo-crate', ...over };
}

describe('verifyShape: crates', () => {
  it('returns null when a .crate file is present', () => {
    expect(verifyShape(row({}), ['artifacts/demo-crate/demo-0.1.0.crate'])).toBeNull();
  });

  it('returns a reason when no .crate file is present', () => {
    expect(verifyShape(row({}), ['artifacts/demo-crate/notes.txt'])).toBe(
      'no .crate file in demo-crate/',
    );
  });
});

describe('verifyShape: pypi', () => {
  const sdist = row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' });
  const wheel = row({ kind: 'pypi', target: 'x86_64-unknown-linux-gnu', artifact_name: 'demo-wheel' });

  it('accepts an sdist row holding a .tar.gz', () => {
    expect(verifyShape(sdist, ['a/readme.md', 'a/demo-0.1.0.tar.gz'])).toBeNull();
  });

  it('rejects an sdist row holding only a wheel', () => {
    expect(verifyShape(sdist, ['a/demo-0.1.0-py3-none-any.whl'])).toBe(
      'no .tar.gz (sdist) in demo-sdist/',
    );
  });

  it('accepts a wheel row holding a .whl', () => {
    expect(verifyShape(wheel, ['a/demo-0.1.0-cp312-cp312-linux_x86_64.whl'])).toBeNull();
  });

  it('rejects a wheel row holding only an sdist', () => {
    expect(verifyShape(wheel, ['a/demo-0.1.0.tar.gz'])).toBe('no .whl file in demo-wheel/');
  });
});

describe('verifyShape: npm', () => {
  const npmMain = row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' });

  it('is ok when package.json sits among other files', () => {
    expect(
      verifyShape(npmMain, [
        'artifacts/demo-npm-main/readme.md',
        'artifacts/demo-npm-main/dist/package.json',
      ]),
    ).toBeNull();
  });

  it('does not accept a filename that merely ends in "package.json" without a `/` boundary', () => {
    expect(verifyShape(npmMain, ['artifacts/demo-npm-main/mypackage.json'])).toBe(
      'no package.json in demo-npm-main/',
    );
  });

  it('requires package.json on a noarch row too', () => {
    const noarch = row({ kind: 'npm', target: 'noarch', artifact_name: 'demo-pkg' });
    expect(verifyShape(noarch, ['a/index.js'])).toBe('no package.json in demo-pkg/');
    expect(verifyShape(noarch, ['a/package.json'])).toBeNull();
  });

  it('accepts any file on a platform row', () => {
    expect(
      verifyShape(row({ kind: 'npm', target: 'linux-x64-gnu', artifact_name: 'demo-plat' }), ['a/demo.node']),
    ).toBeNull();
  });
});
