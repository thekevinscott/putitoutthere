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
  // No `--json`: the subcommand emits a single human line; there's
  // no structured output to consume.
  const argv = ['node', 'putitoutthere', command];
  if (command === 'write-version') {
    if (workingDirectory) argv.push('--path', workingDirectory);
    if (versionInput) argv.push('--version', versionInput);
  } else {
    argv.push('--json');
    if (workingDirectory) argv.push('--cwd', workingDirectory);
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
/* v8 ignore next 3 -- entry-point guard; only reachable when invoked as a binary */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
