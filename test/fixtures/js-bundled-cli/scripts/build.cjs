'use strict';
// Simulates the consumer build script shape that exhibits #384:
// stages a dynamically-linked ELF binary to build/${TARGET}/${BIN},
// overwriting the engine's musl binary when the engine's stage step ran
// before npm run build. The verify step's `file` check catches the regression.
const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const target = process.env.TARGET;
const build = process.env.BUILD;

// Only simulate the overwrite for Linux bundled-cli rows.
// macOS/Windows targets use Mach-O/PE, not ELF; no musl concern there.
if (build !== 'bundled-cli' || !target || target === 'main') process.exit(0);
if (!target.includes('linux')) process.exit(0);

const bin = 'piot-fixture-zzz';
const dir = join('build', target);
mkdirSync(dir, { recursive: true });
// /bin/sh is a dynamically-linked ELF on every Linux runner, reproducing
// the glibc artifact shape that @dirsql/cli-linux-x64-gnu@0.3.11 shipped.
cpSync('/bin/sh', join(dir, bin));
