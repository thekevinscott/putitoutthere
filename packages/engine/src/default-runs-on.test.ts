import { describe, expect, it } from 'vitest';

import { defaultRunsOn } from './default-runs-on.js';

describe('defaultRunsOn', () => {
  it.each([
    ['aarch64-apple-darwin', 'macos-latest'],
    ['darwin-arm64', 'macos-latest'],
    ['universal-mac', 'macos-latest'],
    ['x86_64-pc-windows-msvc', 'windows-2022'],
    ['win32-x64-msvc', 'windows-2022'],
    ['x86_64-pc-windows-gnu', 'windows-2022'],
    ['msvc-only', 'windows-2022'],
    ['aarch64-unknown-linux-gnu', 'ubuntu-24.04-arm'],
    ['aarch64-linux-musl', 'ubuntu-24.04-arm'],
    ['x86_64-unknown-linux-gnu', 'ubuntu-latest'],
    ['linux-arm64-gnu', 'ubuntu-latest'],
  ])('maps %s to %s', (target, runner) => {
    expect(defaultRunsOn(target)).toBe(runner);
  });
});
