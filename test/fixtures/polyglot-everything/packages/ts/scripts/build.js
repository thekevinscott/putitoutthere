// Canary fixture build. See test/fixtures/js-bundled-cli/scripts/build.js
// for the rationale — same shape, same stub.
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
