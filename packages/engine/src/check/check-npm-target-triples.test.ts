import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from '../config.js';
import { assertTripleSupported } from '../handlers/assert-triple-supported.js';
import { checkNpmTargetTriples } from './check-npm-target-triples.js';
import type { CheckFinding } from '../check.js';

vi.mock('../handlers/assert-triple-supported.js');

beforeEach(() => {
  vi.mocked(assertTripleSupported).mockReset();
});

describe('checkNpmTargetTriples', () => {
  it('asserts each triple in both string and object form, adding no finding when supported', () => {
    const findings: CheckFinding[] = [];
    checkNpmTargetTriples(
      [
        {
          name: 'js',
          kind: 'npm',
          targets: ['x86_64-unknown-linux-gnu', { triple: 'aarch64-apple-darwin', runner: 'macos-14' }],
        },
      ] as unknown as readonly Package[],
      findings,
    );
    expect(vi.mocked(assertTripleSupported).mock.calls).toEqual([
      ['x86_64-unknown-linux-gnu', 'js'],
      ['aarch64-apple-darwin', 'js'],
    ]);
    expect(findings).toEqual([]);
  });

  it('records the assertion message as a finding for an unsupported triple', () => {
    vi.mocked(assertTripleSupported).mockImplementation(() => {
      throw new Error('Package "js": Target triple "wasm32-wasi" is not mapped');
    });
    const findings: CheckFinding[] = [];
    checkNpmTargetTriples(
      [{ name: 'js', kind: 'npm', targets: ['wasm32-wasi'] }] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([
      { package: 'js', message: 'Package "js": Target triple "wasm32-wasi" is not mapped' },
    ]);
  });

  it('skips non-npm packages and npm packages without targets', () => {
    const findings: CheckFinding[] = [];
    checkNpmTargetTriples(
      [
        { name: 'rs', kind: 'crates', targets: ['wasm32-wasi'] },
        { name: 'js', kind: 'npm' },
      ] as unknown as readonly Package[],
      findings,
    );
    expect(assertTripleSupported).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
  });
});
