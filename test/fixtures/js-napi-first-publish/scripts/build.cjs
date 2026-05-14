// Canary fixture build. Real napi-rs consumers run `napi build --target X`
// here and produce `<name>.<triple>.node`. The fixture stages a stub at
// the same path so the engine's platform-package synthesis can run end-
// to-end without a Rust toolchain on every runner.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const pkg = require('../package.json');

const target = process.env.TARGET;
if (!target || target === 'main' || target === 'noarch') process.exit(0);

// napi-rs convention: file is named by the unscoped basename.
const base = pkg.name.includes('/') ? pkg.name.split('/')[1] : pkg.name;

const dir = join('build', target);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${base}.${target}.node`), 'fixture canary');
