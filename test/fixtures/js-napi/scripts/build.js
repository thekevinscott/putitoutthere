// Canary fixture build. Real napi-rs consumers run `napi build --target X`
// here and produce `<name>.<triple>.node`. The fixture stages a stub at
// the same path so the engine's platform-package synthesis can run end-
// to-end without a Rust toolchain on every runner.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const pkg = require('../package.json');

const target = process.env.TARGET;
if (!target || target === 'main' || target === 'noarch') process.exit(0);

const dir = join('build', target);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${pkg.name}.${target}.node`), 'fixture canary');
