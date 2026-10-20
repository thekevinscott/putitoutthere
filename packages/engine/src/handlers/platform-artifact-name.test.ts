import { describe, expect, it } from 'vitest';

import { platformArtifactName } from './platform-artifact-name.js';

describe('platformArtifactName', () => {
  it('single-mode keeps the historical <safe>-<triple> shape', () => {
    expect(platformArtifactName('demo-cli', 'napi', 'linux-x64-gnu', false)).toBe(
      'demo-cli-linux-x64-gnu',
    );
  });

  it('multi-mode adds a <mode> infix', () => {
    expect(platformArtifactName('demo-cli', 'napi', 'linux-x64-gnu', true)).toBe(
      'demo-cli-napi-linux-x64-gnu',
    );
    expect(platformArtifactName('demo-cli', 'bundled-cli', 'linux-x64-gnu', true)).toBe(
      'demo-cli-bundled-cli-linux-x64-gnu',
    );
  });

  it('encodes `/` in pkg.name (#237)', () => {
    expect(platformArtifactName('js/cachetta', 'napi', 'linux-x64-gnu', false)).toBe(
      'js__cachetta-linux-x64-gnu',
    );
  });
});
