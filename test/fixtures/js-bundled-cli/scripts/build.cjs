'use strict';
// Reproduces the consumer build script shape behind #384:
// builds with the raw gnu TARGET (no musl substitution) and stages the
// resulting glibc-linked binary, overwriting the engine's musl binary
// when the engine's stage step ran first. The verify step's `file` check
// catches the ordering regression.
const { execFileSync } = require('node:child_process');
const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { arch } = require('node:process');

const target = process.env.TARGET;
const build = process.env.BUILD;

// Only simulate the overwrite for Linux bundled-cli rows.
// macOS/Windows targets use Mach-O/PE, not ELF; no musl concern there.
if (build !== 'bundled-cli' || !target || target === 'main') process.exit(0);
if (!target.includes('linux')) process.exit(0);

// Build with the host's native gnu triple so cargo needs no cross-linker.
// All Linux matrix rows run on x86_64 runners (aarch64 cross-compiles from
// x86_64 host). process.arch guards against a future arm64 runner addition.
const gnuTarget = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
execFileSync('cargo', [
  'build', '--release',
  '--target', gnuTarget,
  '--bin', 'piot-fixture-zzz',
  '--target-dir', 'target-gnu',
], { stdio: 'inherit' });

const bin = 'piot-fixture-zzz';
const dir = join('build', target);
mkdirSync(dir, { recursive: true });
cpSync(join('target-gnu', gnuTarget, 'release', bin), join(dir, bin));
