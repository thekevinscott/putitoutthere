import { describe, expect, it } from 'vitest';

import type { Package } from '../config.js';
import { checkNpmTargetTriples } from './check-npm-target-triples.js';
import type { CheckFinding } from './check-types.js';

describe('checkNpmTargetTriples', () => {
  it('accepts supported triples in both string and object form', () => {
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
    expect(findings).toEqual([]);
  });

  it('flags an unmapped triple with the npm-platform remediation', () => {
    const findings: CheckFinding[] = [];
    checkNpmTargetTriples(
      [{ name: 'js', kind: 'npm', targets: ['wasm32-wasi'] }] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([
      {
        package: 'js',
        message:
          'Package "js": Target triple "wasm32-wasi" is not mapped to npm os/cpu. Add it to TRIPLE_MAP in src/handlers/npm-platform.ts.',
      },
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
    expect(findings).toEqual([]);
  });
});
