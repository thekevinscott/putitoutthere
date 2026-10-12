import { describe, expect, it } from 'vitest';

import { nodePlatformKey } from './node-platform-key.js';

describe('nodePlatformKey', () => {
  it.each([
    ['linux-x64-gnu', 'linux-x64'],
    ['linux-x64-musl', 'linux-x64'],
    ['linux-arm64-gnu', 'linux-arm64'],
    ['linux-arm-gnueabihf', 'linux-arm'],
    ['darwin-x64', 'darwin-x64'],
    ['darwin-arm64', 'darwin-arm64'],
    ['win32-x64-msvc', 'win32-x64'],
    ['win32-arm64-msvc', 'win32-arm64'],
  ])('maps napi-rs short form %s to %s', (triple, key) => {
    expect(nodePlatformKey(triple)).toBe(key);
  });

  it.each([
    ['x86_64-unknown-linux-gnu', 'linux-x64'],
    ['x86_64-unknown-linux-musl', 'linux-x64'],
    ['aarch64-unknown-linux-gnu', 'linux-arm64'],
    ['aarch64-unknown-linux-musl', 'linux-arm64'],
    ['armv7-unknown-linux-gnueabihf', 'linux-arm'],
    ['armv7-unknown-linux-musleabihf', 'linux-arm'],
    ['x86_64-apple-darwin', 'darwin-x64'],
    ['aarch64-apple-darwin', 'darwin-arm64'],
    ['x86_64-pc-windows-msvc', 'win32-x64'],
    ['aarch64-pc-windows-msvc', 'win32-arm64'],
  ])('maps Rust target %s to %s', (triple, key) => {
    expect(nodePlatformKey(triple)).toBe(key);
  });

  it('matches case-insensitively', () => {
    expect(nodePlatformKey('Linux-ARM64-GNU')).toBe('linux-arm64');
    expect(nodePlatformKey('AARCH64-Apple-Darwin')).toBe('darwin-arm64');
  });

  it('throws on an unmapped triple, naming it as given', () => {
    expect(() => nodePlatformKey('Totally-Bogus')).toThrow(
      new Error('write-launcher: target triple "Totally-Bogus" is not mapped to Node platform+arch'),
    );
  });
});
