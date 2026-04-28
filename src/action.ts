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
  const failOnError =
    (process.env.INPUT_FAIL_ON_ERROR ?? 'true').toLowerCase() !== 'false';

  if (!command) {
    process.stderr.write(
      'putitoutthere action: missing required input `command`\n',
    );
    process.exit(1);
  }

  const argv = ['node', 'putitoutthere', command, '--json'];
  if (workingDirectory) argv.push('--cwd', workingDirectory);

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
