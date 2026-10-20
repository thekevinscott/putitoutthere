import { describe, expect, it } from 'vitest';

import { parsePythonVersion } from './parse-python-version.js';

describe('parsePythonVersion', () => {
  it('splits a dotted version into numbers', () => {
    expect(parsePythonVersion('3.10.1')).toEqual([3, 10, 1]);
  });

  it('parses a bare major', () => {
    expect(parsePythonVersion('3')).toEqual([3]);
  });
});
