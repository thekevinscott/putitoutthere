import { describe, expect, it } from 'vitest';

import { isBulletLine } from './bullet-line.js';

describe('isBulletLine', () => {
  it('matches "- foo"', () => {
    expect(isBulletLine('- foo')).toBe(true);
  });

  it('matches a bullet with leading whitespace', () => {
    expect(isBulletLine('   - foo')).toBe(true);
  });

  it('matches multiple spaces after the dash', () => {
    expect(isBulletLine('-   foo')).toBe(true);
  });

  it('matches a tab after the dash', () => {
    expect(isBulletLine('-\tfoo')).toBe(true);
  });

  it('rejects a dash with no whitespace after it', () => {
    expect(isBulletLine('-foo')).toBe(false);
  });

  it('rejects a non-dash marker', () => {
    expect(isBulletLine('* foo')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isBulletLine('foo')).toBe(false);
  });

  it('rejects whitespace only', () => {
    expect(isBulletLine('   ')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isBulletLine('')).toBe(false);
  });
});
