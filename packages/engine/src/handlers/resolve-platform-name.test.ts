import { describe, expect, it } from 'vitest';

import { resolvePlatformName } from './resolve-platform-name.js';

describe('resolvePlatformName', () => {
  it('default template + unscoped name → name-triple', () => {
    expect(
      resolvePlatformName('{name}-{triple}', {
        name: 'demo-cli',
        triple: 'linux-x64-gnu',
        mode: 'napi',
      }),
    ).toBe('demo-cli-linux-x64-gnu');
  });

  it('default template + scoped name → @scope/base-triple', () => {
    expect(
      resolvePlatformName('{name}-{triple}', {
        name: '@acme/demo-cli',
        triple: 'linux-x64-gnu',
        mode: 'napi',
      }),
    ).toBe('@acme/demo-cli-linux-x64-gnu');
  });

  it('substitutes {scope} and {base} from a scoped name', () => {
    expect(
      resolvePlatformName('@{scope}/lib-{triple}', {
        name: '@dirsql/core',
        triple: 'linux-x64-gnu',
        mode: 'napi',
      }),
    ).toBe('@dirsql/lib-linux-x64-gnu');
  });

  it('{scope} resolves to empty string for unscoped names', () => {
    expect(
      resolvePlatformName('{scope}-{base}-{triple}', {
        name: 'unscoped',
        triple: 'darwin-arm64',
        mode: 'napi',
      }),
    ).toBe('-unscoped-darwin-arm64');
  });

  it('substitutes {mode}', () => {
    expect(
      resolvePlatformName('{name}-{mode}-{triple}', {
        name: 'demo',
        triple: 'linux-x64-gnu',
        mode: 'bundled-cli',
      }),
    ).toBe('demo-bundled-cli-linux-x64-gnu');
  });

  it('treats a name as scoped only when the whole name is @scope/base', () => {
    const vars = { triple: 'linux-x64-gnu', mode: 'napi' } as const;
    expect(resolvePlatformName('{scope}|{base}', { ...vars, name: 'demo@acme/cli' })).toBe('|demo@acme/cli');
    expect(resolvePlatformName('{scope}|{base}', { ...vars, name: '@acme/cli\nx' })).toBe('|@acme/cli\nx');
  });

  it('throws on an unknown placeholder', () => {
    expect(() =>
      resolvePlatformName('{name}-{version}', { name: 'demo', triple: 'linux-x64-gnu', mode: 'napi' }),
    ).toThrow('unknown placeholder {version} in name template');
  });
});
