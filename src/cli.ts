/**
 * `putitoutthere` CLI entry. Internal seam — the reusable workflow
 * (`.github/workflows/release.yml`) invokes this. Not a consumer-
 * facing surface; flags / help text are stable enough to test, but
 * not promised externally. See `notes/design-commitments.md`.
 *
 * Commands:
 *   plan       — compute and emit the release plan
 *   publish    — execute the plan against the registries
 *   version    — print CLI version
 *
 * Global flags:
 *   --cwd <path>      working directory (default: process.cwd())
 *   --config <path>   path to putitoutthere.toml
 *   --dry-run         for publish; no side effects
 *   --json            machine-readable output
 */

import { plan } from './plan.js';
import { publish } from './publish.js';
import { VERSION } from './version.js';

const COMMANDS = ['plan', 'publish', 'version'] as const;
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
      '  plan       Compute and emit the release plan',
      '  publish    Execute the plan',
      '  version    Print CLI version',
      '',
      'Options:',
      '  --cwd <path>      working directory',
      '  --config <path>   path to putitoutthere.toml',
      '  --dry-run         publish without side effects',
      '  --json            emit machine-readable output',
      '',
      'See https://github.com/thekevinscott/putitoutthere for docs.',
      '',
    ].join('\n'),
  );
}

interface ParsedFlags {
  cwd: string;
  config?: string | undefined;
  dryRun: boolean;
  json: boolean;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const out: ParsedFlags = {
    cwd: process.cwd(),
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    /* v8 ignore next -- ?? fallback is for malformed argv; tests always pass the value */
    if (a === '--cwd') out.cwd = argv[++i] ?? out.cwd;
    else if (a === '--config') out.config = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
  }
  return out;
}

export async function run(argv: readonly string[]): Promise<number> {
  const [, , cmd, ...rest] = argv;
  // Bare invocation: short hint pointing at --help rather than dumping
  // the full usage (#150). Matches the unknown-command error shape.
  if (cmd === undefined) {
    process.stderr.write(
      'putitoutthere: missing command. Run `putitoutthere --help` for usage.\n',
    );
    return 1;
  }
  if (cmd === '-h' || cmd === '--help') {
    printUsage();
    return 0;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    process.stdout.write(`putitoutthere ${VERSION}\n`);
    return 0;
  }
  if (!isCommand(cmd)) {
    process.stderr.write(`putitoutthere: unknown command: ${cmd}\n`);
    printUsage();
    return 1;
  }

  const flags = parseFlags(rest);
  try {
    switch (cmd) {
      case 'plan': {
        const matrix = await plan({
          cwd: flags.cwd,
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(matrix) + '\n');
        } else {
          if (matrix.length === 0) {
            process.stdout.write('no packages to release\n');
          } else {
            process.stdout.write(`${matrix.length} matrix row(s):\n`);
            for (const row of matrix) {
              process.stdout.write(
                `  ${row.name}  version=${row.version}  target=${row.target}  artifact=${row.artifact_name}\n`,
              );
            }
          }
        }
        // GHA `outputs.matrix` — append to $GITHUB_OUTPUT when present.
        // Skip the write entirely when the matrix is empty (#146): the
        // consumer workflow's `if: fromJson(...).length > 0` style guard
        // only fires when the output key exists, and emitting `matrix=[]`
        // races against the "output not set" branch the workflow expects.
        const githubOutput = process.env.GITHUB_OUTPUT;
        if (githubOutput && matrix.length > 0) {
          await import('node:fs').then((fs) =>
            fs.appendFileSync(
              githubOutput,
              `matrix=${JSON.stringify(matrix)}\n`,
              'utf8',
            ),
          );
        }
        return 0;
      }
      case 'publish': {
        const result = await publish({
          cwd: flags.cwd,
          /* v8 ignore next -- --config test covered in plan arm; publish shares the same plumbing */
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
          dryRun: flags.dryRun,
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(result) + '\n');
        } else if (result.published.length === 0) {
          process.stdout.write('published: (nothing)\n');
          /* v8 ignore start -- non-empty publish path requires real registry access; covered by e2e */
        } else {
          for (const p of result.published) {
            process.stdout.write(
              `published: ${p.package}@${p.version}  status=${p.result.status}\n`,
            );
          }
        }
        /* v8 ignore stop */
        return 0;
      }
      /* v8 ignore next 3 -- exhaustive; 'version' handled above */
      case 'version':
        return 0;
    }
  } catch (err) {
    process.stderr.write(
      `putitoutthere: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

// Binary entry point lives in `src/cli-bin.ts` to keep this module
// guard-free — see #201.
