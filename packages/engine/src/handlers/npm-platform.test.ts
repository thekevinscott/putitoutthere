import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NAME_TEMPLATE,
  looksLikePublishOverRace,
  normalizeBuild,
  toRustTriple,
} from './npm-platform.js';
import { looksLikePublishOverRace as looksLikePublishOverRaceImpl } from './looks-like-publish-over-race.js';
import { toRustTriple as toRustTripleImpl } from './to-rust-triple.js';

vi.mock('./looks-like-publish-over-race.js');
vi.mock('./to-rust-triple.js');

describe('normalizeBuild', () => {
  it('returns [] for undefined', () => {
    expect(normalizeBuild(undefined)).toEqual([]);
  });

  it('coerces a single-mode string into a length-1 array with the default template', () => {
    expect(normalizeBuild('napi')).toEqual([
      { mode: 'napi', name: DEFAULT_NAME_TEMPLATE },
    ]);
  });

  it('coerces a length-1 array of strings into the same shape as the string form', () => {
    expect(normalizeBuild(['bundled-cli'])).toEqual([
      { mode: 'bundled-cli', name: DEFAULT_NAME_TEMPLATE },
    ]);
  });

  it('passes through object-form entries verbatim', () => {
    expect(
      normalizeBuild([
        { mode: 'napi', name: '@dirsql/lib-{triple}' },
        { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
      ]),
    ).toEqual([
      { mode: 'napi', name: '@dirsql/lib-{triple}' },
      { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
    ]);
  });

  it('accepts mixed entries (bare string + object form) in the same array', () => {
    expect(
      normalizeBuild([
        'napi',
        { mode: 'bundled-cli', name: '{name}-cli-{triple}' },
      ]),
    ).toEqual([
      { mode: 'napi', name: DEFAULT_NAME_TEMPLATE },
      { mode: 'bundled-cli', name: '{name}-cli-{triple}' },
    ]);
  });
});

describe('looksLikePublishOverRace re-export', () => {
  it('is the same function npm.ts reaches through npm-platform', () => {
    expect(looksLikePublishOverRace).toBe(looksLikePublishOverRaceImpl);
  });
});

describe('toRustTriple re-export', () => {
  it('is the same function plan.ts reaches through npm-platform', () => {
    expect(toRustTriple).toBe(toRustTripleImpl);
  });
});
