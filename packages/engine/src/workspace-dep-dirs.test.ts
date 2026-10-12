import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { absolute, workspaceDepDirs } from './workspace-dep-dirs.js';

const ROOT = '/repo';

describe('workspaceDepDirs', () => {
  it('keys path entries by name, resolved against the workspace root', () => {
    const ws = {
      workspace: {
        dependencies: {
          core: { path: 'packages/core', version: '0.2' },
          util: { path: 'packages/util' },
        },
      },
    };
    expect(workspaceDepDirs(ws, ROOT)).toEqual(
      new Map([
        ['core', { dir: resolve(ROOT, 'packages/core'), hasVersionReq: true }],
        ['util', { dir: resolve(ROOT, 'packages/util'), hasVersionReq: false }],
      ]),
    );
  });

  it('omits registry entries, non-string paths, and non-object entries', () => {
    const ws = {
      workspace: {
        dependencies: { serde: { version: '1' }, odd: { path: 42 }, bare: '1', nul: null },
      },
    };
    expect(workspaceDepDirs(ws, ROOT).size).toBe(0);
  });

  it('treats a non-string version as no requirement', () => {
    const ws = { workspace: { dependencies: { core: { path: 'core', version: 2 } } } };
    expect(workspaceDepDirs(ws, ROOT).get('core')?.hasVersionReq).toBe(false);
  });

  it.each([null, undefined, 'x', {}, { workspace: null }, { workspace: { dependencies: null } }])(
    'returns an empty map for a manifest with no dependencies table (%j)',
    (parsed) => {
      expect(workspaceDepDirs(parsed, ROOT).size).toBe(0);
    },
  );
});

describe('absolute', () => {
  it('keeps an absolute path as written', () => {
    expect(absolute('/elsewhere/core', ROOT)).toBe('/elsewhere/core');
  });

  it('resolves a relative path against the base', () => {
    expect(absolute('core', ROOT)).toBe(resolve(ROOT, 'core'));
  });
});
