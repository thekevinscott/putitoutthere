import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printUsage } from './print-usage.js';

let stderr: string[];
let stdout: string[];

beforeEach(() => {
  stderr = [];
  stdout = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printUsage', () => {
  it('writes the full usage text to stderr in one write', () => {
    printUsage();
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      [
        'Usage: putitoutthere <command> [options]',
        '',
        'Commands:',
        '  plan           Compute and emit the release plan',
        '  publish        Execute the plan',
        '  check          Pre-merge configuration validation (#319)',
        '  status         Report registry-vs-tag drift (read-only; #403)',
        '  reconcile      Backfill missing tags for published-but-untagged packages (#403)',
        '  resolve        Emit willfire\'s callback map for the e2e plan job (#683)',
        '  verify         Report publish/trust posture — OIDC vs token, per registry (#403)',
        '  verify npm-tarball  Assert a published npm tarball honors package.json files[] (#443)',
        '  verify crate   Assert a published .crate ships its source tree (#449)',
        '  verify wheel   Assert a built wheel/sdist carries the planned version (#450)',
        '  verify bundle-cli  Assert a maturin wheel contains its staged bundle_cli binary (#451)',
        '  release-github Cut a GitHub Release for each new tag on HEAD (#444)',
        '  advance-v0     Force-move the floating v0 tag to HEAD (#446)',
        '  advance-floating-major  Move the floating v<major> tag to the latest release (#446)',
        '  fold-bundle    Commit the built dist-action/ bundle on top of HEAD (#446)',
        '  write-version  Bump a package manifest to the planned version (pre-build; #276)',
        '  write-crate-version  Bump a crate Cargo.toml to the planned version (pre-build; #366)',
        '  write-launcher Generate the bundled-cli npm launcher script (pre-build; #299)',
        '  npm-build      Install an npm package\'s dependencies and run its build',
        '  version        Print CLI version',
        '',
        'Options:',
        '  --cwd <path>      working directory',
        '  --config <path>   path to putitoutthere.toml',
        '  --subject <s>     bundle-commit subject line (fold-bundle)',
        '  --path <dir>      package or crate directory (write-version / write-crate-version)',
        '  --version <v>     planned version (write-version / write-crate-version)',
        '  --release-packages <spec>  manual-release spec (plan / publish)',
        '  --matrix <json>   plan matrix (verify npm-tarball)',
        '  --registry <url>  registry to read from (verify npm-tarball); default real npm',
        '  --registry-root <dir>  cargo-http-registry disk root to read .crate files from (verify crate)',
        '  --target <t>      matrix target: `sdist` or a wheel triple (verify wheel / bundle-cli)',
        '  --manylinux <m>   manylinux baseline the wheel filename must carry (verify wheel; #610)',
        '  --stage-to <dir>  wheel-relative dir the bundle_cli binary is staged into (verify bundle-cli)',
        '  --bin <name>      bundle_cli binary name (verify bundle-cli)',
        '  --per-triple      verify synthesized per-triple tarballs (verify npm-tarball)',
        '  --check           exit non-zero when status finds drift',
        '  --dry-run         report what reconcile would do without writing tags',
        '  --expect <spec>   reconcile: confirm & tag exactly <name>@<version> (or a JSON [{name,version}] array), skipping latest-version discovery (#666)',
        '  --json            emit machine-readable output',
        '',
        'See https://github.com/thekevinscott/putitoutthere for docs.',
        '',
      ].join('\n'),
    ]);
  });
});
