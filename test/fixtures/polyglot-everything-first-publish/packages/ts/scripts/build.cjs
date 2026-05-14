// Canary fixture build for the multi-mode npm shape (#dirsql).
//
// The fixture's putitoutthere.toml declares two build entries — `napi`
// and `bundled-cli` — so each per-platform row carries both a
// `target` (the triple) and a `build` (the mode) that the e2e workflow
// passes to this script as TARGET / BUILD env vars. A real consumer
// runs `napi build --target $TARGET` for napi rows and a cross-target
// cargo-build for bundled-cli rows; the fixture writes a stub so the
// engine's platform-package synthesis can run end-to-end without a Rust
// toolchain on every runner.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const pkg = require('../package.json');

const target = process.env.TARGET;
const mode = process.env.BUILD;
if (!target || target === 'main' || target === 'noarch') process.exit(0);

// plan.ts emits `build/<mode>-<triple>` for multi-mode rows so the two
// families' artifacts don't collide. Single-mode (string-form `build`)
// would emit `build/<triple>` — the fallback covers that case for any
// future single-mode reuse of this script.
const dir = mode ? join('build', `${mode}-${target}`) : join('build', target);
mkdirSync(dir, { recursive: true });

if (mode === 'napi') {
  // napi-rs convention: file is named by the unscoped basename.
  const base = pkg.name.includes('/') ? pkg.name.split('/')[1] : pkg.name;
  writeFileSync(join(dir, `${base}.${target}.node`), 'fixture canary');
} else {
  // bundled-cli: a per-target binary named after `pkg.bin`.
  const binName = Object.keys(pkg.bin || {})[0] || pkg.name;
  const ext = target.includes('windows') ? '.exe' : '';
  writeFileSync(join(dir, `${binName}${ext}`), 'fixture canary');
}
