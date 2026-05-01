/**
 * GitHub Actions wrapper. Bundled to `dist-action/index.js` via ncc.
 *
 * ~50-line adapter: read `INPUT_COMMAND` / `INPUT_FAIL_ON_ERROR` →
 * invoke the SDK's run() → surface the exit code. No GHA-specific
 * logic lives here beyond input parsing.
 *
 * Issue #24. Plan: §5.2, §5.3.
 */

import { run } from './cli.js';

export async function main(): Promise<void> {
  const command = process.env.INPUT_COMMAND ?? '';
  const workingDirectory = process.env.INPUT_WORKING_DIRECTORY ?? '';
  const versionInput = process.env.INPUT_VERSION ?? '';
  const failOnError =
    (process.env.INPUT_FAIL_ON_ERROR ?? 'true').toLowerCase() !== 'false';

  // TEMPORARY DIAGNOSTIC (#276): on Windows runners write-version
  // exits 0 but neither pyproject nor Cargo gets bumped. Surface the
  // env-var values the action received as a workflow warning so we
  // can see what dispatched without spelunking collapsed step logs.
  // Strip once Windows-specific failure mode is fixed.
  if (command === 'write-version') {
    process.stdout.write(
      `::warning title=piot-action diag #276::command='${command}' workingDirectory='${workingDirectory}' version='${versionInput}' platform='${process.platform}' cwd='${process.cwd()}'\n`,
    );
  }

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

/* v8 ignore next 3 -- entry-point guard; only reachable when invoked as a binary */
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
