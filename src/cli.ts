#!/usr/bin/env node
/**
 * `putitoutthere` CLI entry. Thin wrapper around the SDK.
 *
 * Command implementations land in #20 (init), #21 (plan), #22 (publish),
 * #23 (doctor). This scaffold just parses the command name and prints a
 * not-yet-implemented message, so the binary is installable today.
 */

const COMMANDS = ['init', 'plan', 'publish', 'doctor', 'version'] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

function printUsage(): void {
  process.stderr.write(
    [
      'Usage: putitoutthere <command> [options]',
      '',
      'Commands:',
      '  init       Scaffold putitoutthere.toml + workflows + AGENTS.md (#20)',
      '  plan       Compute and emit the release plan (#21)',
      '  publish    Execute the plan (#22)',
      '  doctor     Validate config + handlers + auth (#23)',
      '  version    Print CLI version',
      '',
      'See https://github.com/thekevinscott/put-it-out-there for docs.',
      '',
    ].join('\n'),
  );
}

export function run(argv: readonly string[]): Promise<number> {
  const [, , cmd, ..._rest] = argv;
  if (cmd === undefined || cmd === '-h' || cmd === '--help') {
    printUsage();
    return Promise.resolve(cmd === undefined ? 1 : 0);
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    process.stdout.write('putitoutthere 0.0.0 (pre-release scaffold)\n');
    return Promise.resolve(0);
  }
  if (!isCommand(cmd)) {
    process.stderr.write(`putitoutthere: unknown command: ${cmd}\n`);
    printUsage();
    return Promise.resolve(1);
  }
  process.stderr.write(
    `putitoutthere: '${cmd}' is not implemented yet in this scaffold. See the v0 epic: https://github.com/thekevinscott/put-it-out-there/issues/2\n`,
  );
  return Promise.resolve(2);
}

// Entry point when invoked as `putitoutthere` or `node dist/cli.js`.
/* v8 ignore start -- entry-point guard; only reachable when invoked as a binary */
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      process.stderr.write(`putitoutthere: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(4);
    },
  );
}
/* v8 ignore stop */
