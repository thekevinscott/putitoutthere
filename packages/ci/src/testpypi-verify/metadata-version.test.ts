/**
 * Pins that `metadataVersion` reproduces the bash's
 * `line.removeprefix("Version: ").strip()` over the first `Version:` line:
 * first match wins, `null` when absent, surrounding whitespace stripped, and
 * the trailing space in the prefix is required.
 */

import { describe, expect, it } from 'vitest';

import { metadataVersion } from './metadata-version.js';

describe('metadataVersion', () => {
  it('returns the first Version field value', () => {
    expect(metadataVersion('Name: x\nVersion: 1.2.3\nSummary: y')).toBe('1.2.3');
  });

  it('returns the first when several Version lines are present', () => {
    expect(metadataVersion('Version: 1.0.0\nVersion: 2.0.0')).toBe('1.0.0');
  });

  it('returns null when no Version line is present', () => {
    expect(metadataVersion('Name: x\nSummary: y')).toBeNull();
  });

  it('strips surrounding whitespace and a trailing carriage return', () => {
    expect(metadataVersion('Version:  1.0.0 \r')).toBe('1.0.0');
  });

  it('does not match a Version prefix that lacks the trailing space', () => {
    expect(metadataVersion('Version:1.0.0')).toBeNull();
  });
});
