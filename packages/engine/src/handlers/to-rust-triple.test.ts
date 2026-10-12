import { describe, expect, it } from 'vitest';

import { toRustTriple } from './to-rust-triple.js';

describe('toRustTriple (#387)', () => {
  // Every napi-rs short form maps to its Rust triple. These are the
  // triples `rustup target add` / `cargo build --target` consume in the
  // npm bundled-cli cross-compile; the npm-flavor form they reject.
  it.each([
    ['linux-x64-gnu', 'x86_64-unknown-linux-gnu'],
    ['linux-x64-musl', 'x86_64-unknown-linux-musl'],
    ['linux-arm64-gnu', 'aarch64-unknown-linux-gnu'],
    ['linux-arm64-musl', 'aarch64-unknown-linux-musl'],
    ['linux-arm-gnueabihf', 'armv7-unknown-linux-gnueabihf'],
    ['linux-arm-musleabihf', 'armv7-unknown-linux-musleabihf'],
    ['darwin-x64', 'x86_64-apple-darwin'],
    ['darwin-arm64', 'aarch64-apple-darwin'],
    ['win32-x64-msvc', 'x86_64-pc-windows-msvc'],
    ['win32-arm64-msvc', 'aarch64-pc-windows-msvc'],
  ])('maps napi triple %s → rust triple %s', (napi, rust) => {
    expect(toRustTriple(napi)).toBe(rust);
  });

  it('covers every napi key TRIPLE_MAP accepts (no plan-time drift)', () => {
    // assertTripleSupported gates on TRIPLE_MAP, then plan calls
    // toRustTriple — so every napi triple a consumer can legally declare
    // must resolve here. A new TRIPLE_MAP napi entry without a NAPI_TO_RUST
    // entry would throw mid-plan; this pins the two maps together.
    const napiKeys = [
      'linux-x64-gnu',
      'linux-x64-musl',
      'linux-arm64-gnu',
      'linux-arm64-musl',
      'linux-arm-gnueabihf',
      'linux-arm-musleabihf',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64-msvc',
      'win32-arm64-msvc',
    ];
    for (const t of napiKeys) {
      expect(() => toRustTriple(t)).not.toThrow();
    }
  });

  it('passes a Rust triple through unchanged (identity)', () => {
    expect(toRustTriple('x86_64-unknown-linux-gnu')).toBe('x86_64-unknown-linux-gnu');
    expect(toRustTriple('aarch64-apple-darwin')).toBe('aarch64-apple-darwin');
  });

  it('is case-insensitive, mirroring targetToOsCpu', () => {
    expect(toRustTriple('LINUX-X64-GNU')).toBe('x86_64-unknown-linux-gnu');
  });

  it('throws a descriptive error for unmappable triples', () => {
    expect(() => toRustTriple('mips64-unknown-linux-gnu')).toThrow(
      /mips64-unknown-linux-gnu.*NAPI_TO_RUST.*src\/handlers\/to-rust-triple\.ts/,
    );
  });
});
