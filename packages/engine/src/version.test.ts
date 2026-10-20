/**
 * Version bumper tests. TDD-style.
 *
 * Semantics per plan.md §14.3, §14.4.
 *
 * Issue #8.
 */

import { describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { bump, USER_AGENT, VERSION } from './version.js';

// `../package.json` is the collaborator `version.ts` reads its VERSION from.
// The options-form `{ spy: true }` mock (not a factory) intercepts the module
// for unit isolation while passing the real values through, so VERSION/USER_AGENT
// still reflect the actual package.json — the contract under test.
vi.mock('../package.json', { spy: true });

describe('bump: patch', () => {
  it('0.1.0 → 0.1.1', () => {
    expect(bump('0.1.0', 'patch')).toBe('0.1.1');
  });

  it('0.0.9 → 0.0.10', () => {
    expect(bump('0.0.9', 'patch')).toBe('0.0.10');
  });

  it('2.3.4 → 2.3.5', () => {
    expect(bump('2.3.4', 'patch')).toBe('2.3.5');
  });
});

describe('bump: minor', () => {
  it('0.1.5 → 0.2.0 (zeros patch)', () => {
    expect(bump('0.1.5', 'minor')).toBe('0.2.0');
  });

  it('1.0.0 → 1.1.0', () => {
    expect(bump('1.0.0', 'minor')).toBe('1.1.0');
  });

  it('does not use pre-1.0 breaking-minor-bump convention', () => {
    // Plan.md §14.3 explicitly says we stay strict-semver pre-1.0.
    // 0.1.5 + minor is 0.2.0, not 1.0.0.
    expect(bump('0.1.5', 'minor')).toBe('0.2.0');
  });
});

describe('bump: major', () => {
  it('0.1.5 → 1.0.0 (zeros minor + patch)', () => {
    expect(bump('0.1.5', 'major')).toBe('1.0.0');
  });

  it('1.2.3 → 2.0.0', () => {
    expect(bump('1.2.3', 'major')).toBe('2.0.0');
  });
});

describe('bump: input validation', () => {
  it('rejects an invalid last version', () => {
    expect(() => bump('1.2', 'patch')).toThrow();
  });

  it('rejects an invalid bump type', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => bump('1.0.0', 'huge')).toThrow();
  });
});

describe('VERSION + USER_AGENT (#147)', () => {
  it('VERSION reflects package.json at build time', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('USER_AGENT embeds the current version, not a hardcoded 0.0.1', () => {
    expect(USER_AGENT).toBe(`putitoutthere/${pkg.version}`);
    expect(USER_AGENT).toMatch(/^putitoutthere\/\d+\.\d+\.\d+$/);
  });
});
