import { describe, expect, it } from 'vitest';

import { parseFixtureDocument } from './parse-fixture-document.js';

const VALID = JSON.stringify({ fixture: 'js-vanilla', matrix: [{ kind: 'npm' }], has_pypi: false });

describe('parseFixtureDocument', () => {
  it('accepts a well-formed fixture-matrix document', () => {
    expect(parseFixtureDocument(VALID, 'js-vanilla')).toEqual({
      fixture: 'js-vanilla',
      matrix: [{ kind: 'npm' }],
      has_pypi: false,
    });
  });

  it('rejects non-JSON output', () => {
    expect(() => parseFixtureDocument('not json', 'js-vanilla')).toThrow(
      /invalid JSON for 'js-vanilla'/,
    );
  });

  it('rejects a non-object document', () => {
    expect(() => parseFixtureDocument('null', 'js-vanilla')).toThrow(
      "resolve: fixture-matrix emitted a non-object for 'js-vanilla'",
    );
    expect(() => parseFixtureDocument('"str"', 'js-vanilla')).toThrow(
      "resolve: fixture-matrix emitted a non-object for 'js-vanilla'",
    );
  });

  it('rejects a document answering for a different fixture', () => {
    expect(() => parseFixtureDocument(VALID, 'js-napi')).toThrow(
      /unexpected document for 'js-napi'/,
    );
  });

  it('rejects a non-array matrix', () => {
    const raw = JSON.stringify({ fixture: 'js-vanilla', matrix: 'nope', has_pypi: false });
    expect(() => parseFixtureDocument(raw, 'js-vanilla')).toThrow(/unexpected document/);
  });

  it('rejects a non-boolean has_pypi', () => {
    const raw = JSON.stringify({ fixture: 'js-vanilla', matrix: [], has_pypi: 'false' });
    expect(() => parseFixtureDocument(raw, 'js-vanilla')).toThrow(/unexpected document/);
  });
});
