/**
 * GitHub Actions wrapper. Bundled to `dist-action/index.js` via ncc.
 *
 * ~50-line adapter: read `INPUT_COMMAND` / `INPUT_FAIL_ON_ERROR` →
 * invoke the SDK's run() → surface the exit code. No GHA-specific
 * logic lives here beyond input parsing.
 *
 * Issue #24. Plan: §5.2, §5.3.
 */

import { pathToFileURL } from 'node:url';

import { run } from './cli.js';

export async function main(): Promise<void> {
  const command = process.env.INPUT_COMMAND ?? '';
  const workingDirectory = process.env.INPUT_WORKING_DIRECTORY ?? '';
  const versionInput = process.env.INPUT_VERSION ?? '';
  const releasePackages = process.env.INPUT_RELEASE_PACKAGES ?? '';
  const stageTo = process.env.INPUT_STAGE_TO ?? '';
  const bin = process.env.INPUT_BIN ?? '';
  const target = process.env.INPUT_TARGET ?? '';
  const failOnError =
    (process.env.INPUT_FAIL_ON_ERROR ?? 'true').toLowerCase() !== 'false';

  if (!command) {
    process.stderr.write(
      'putitoutthere action: missing required input `command`\n',
    );
    process.exit(1);
  }

  // #276: write-version uses a different argv shape — `--path` (the
  // package dir, sourced from `working_directory`) and `--version`.
  // #366: write-crate-version shares that shape — `--path` (the
  // bundled-cli crate dir, sourced from `working_directory`) and
  // `--version`.
  // #299: write-launcher takes `--path` (the matrix row's package dir,
  // sourced from `working_directory`) and reads `--cwd` from
  // process.cwd() — the runner working dir is the repo root, where
  // `putitoutthere.toml` lives.
  // #595: verify-bundle-cli takes `--path` (the matrix row's package dir,
  // sourced from `working_directory`) plus `--stage-to` / `--bin` /
  // `--target`. It is the one input whose CLI form is two argv tokens
  // (`verify bundle-cli`), because `verify` is a command with
  // subcommands; Actions inputs are flat, so the hyphenated spelling is
  // the input and the split happens here.
  // No `--json` on any of them: these subcommands emit a single human
  // line; there's no structured output to consume.
  const argv = command === 'verify-bundle-cli'
    ? ['node', 'putitoutthere', 'verify', 'bundle-cli']
    : ['node', 'putitoutthere', command];
  if (command === 'write-version' || command === 'write-crate-version') {
    if (workingDirectory) {argv.push('--path', workingDirectory);}
    if (versionInput) {argv.push('--version', versionInput);}
  } else if (command === 'write-launcher') {
    if (workingDirectory) {argv.push('--path', workingDirectory);}
  } else if (command === 'verify-bundle-cli') {
    if (workingDirectory) {argv.push('--path', workingDirectory);}
    if (stageTo) {argv.push('--stage-to', stageTo);}
    if (bin) {argv.push('--bin', bin);}
    if (target) {argv.push('--target', target);}
  } else {
    argv.push('--json');
    if (workingDirectory) {argv.push('--cwd', workingDirectory);}
    // Manual release: forward `release_packages` to the CLI. Only
    // `plan` / `publish` act on it; the flag parses harmlessly for the
    // other commands that land in this branch.
    if (releasePackages) {argv.push('--release-packages', releasePackages);}
  }

  const code = await run(argv);
  if (code !== 0 && !failOnError) {
    process.stderr.write(
      `putitoutthere action: ignoring non-zero exit (fail_on_error=false): ${code}\n`,
    );
    process.exit(0);
  }
  process.exit(code);
}

// Entry-point guard. Compare via `pathToFileURL` so the guard fires on
// Windows too: `import.meta.url` is a `file://` URL with forward
// slashes (`file:///D:/.../index.js`), while `process.argv[1]` is the
// native path (`D:\...\index.js`). Concatenating `file://` to the
// native path produces a string that never equals the URL on Windows,
// so the previous guard silently no-op'd the entire action when ncc-
// bundled and invoked via `uses: ./` on a windows-latest runner —
// `main()` was never called, the action exited 0 immediately, and
// `_matrix.yml`'s pre-maturin write-version step bumped nothing
// (PR #277, e2e Windows maturin failures). Issue #276.
/* v8 ignore start -- entry-point guard; only reachable when invoked as a binary */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
/* v8 ignore stop */
