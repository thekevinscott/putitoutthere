// Canary fixture build. Real bundled-cli consumers cargo-build a Rust
// binary cross-target here and stage it under build/<triple>/<bin-name>.
// The fixture writes a stub at the expected path so the engine's
// platform-package synthesis can run end-to-end without a Rust toolchain
// on every runner.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const pkg = require('../package.json');

const target = process.env.TARGET;
if (!target || target === 'main' || target === 'noarch') process.exit(0);

const binName = Object.keys(pkg.bin || {})[0] || pkg.name;
const ext = target.includes('windows') ? '.exe' : '';
const dir = join('build', target);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${binName}${ext}`), 'fixture canary');
