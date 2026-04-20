#!/usr/bin/env node
/**
 * `putitoutthere` CLI entry. Thin wrapper around the SDK.
 *
 * plan   → src/plan.ts
 * publish → src/publish.ts
 * init   → TODO #20
 * doctor → TODO #23
 *
 * Global flags:
 *   --cwd <path>      working directory (default: process.cwd())
 *   --config <path>   path to putitoutthere.toml
 *   --dry-run         for publish; no side effects
 *   --json            for plan; emit JSON instead of a table
 */

import pkg from '../package.json' with { type: 'json' };
import { doctor } from './doctor.js';
import { init } from './init.js';
import { plan } from './plan.js';
import { runPreflight } from './preflight-run.js';
import { publish } from './publish.js';

const VERSION = pkg.version;

const COMMANDS = ['init', 'plan', 'publish', 'doctor', 'preflight', 'version'] as const;
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
      '  plan       Compute and emit the release plan',
      '  publish    Execute the plan',
      '  doctor     Validate config + handlers + auth (#23)',
      '  preflight  Run every pre-publish check without side effects (#93)',
      '  version    Print CLI version',
      '',
      'Options:',
      '  --cwd <path>      working directory',
      '  --config <path>   path to putitoutthere.toml',
      '  --dry-run         publish without side effects',
      '  --json            emit machine-readable output (plan only)',
      '  --force           overwrite putitoutthere.toml on init',
      '  --artifacts       doctor: also check artifact completeness',
      '  --all             preflight: include non-cascaded packages too',
      '  --cadence <mode>  init: immediate (default) or scheduled',
      '',
      'See https://github.com/thekevinscott/put-it-out-there for docs.',
      '',
    ].join('\n'),
  );
}

interface ParsedFlags {
  cwd: string;
  config?: string | undefined;
  dryRun: boolean;
  json: boolean;
  force: boolean;
  artifacts: boolean;
  all: boolean;
  cadence?: 'immediate' | 'scheduled';
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const out: ParsedFlags = {
    cwd: process.cwd(),
    dryRun: false,
    json: false,
    force: false,
    artifacts: false,
    all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    /* v8 ignore next -- ?? fallback is for malformed argv; tests always pass the value */
    if (a === '--cwd') out.cwd = argv[++i] ?? out.cwd;
    else if (a === '--config') out.config = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '--force') out.force = true;
    else if (a === '--artifacts') out.artifacts = true;
    else if (a === '--all') out.all = true;
    else if (a === '--cadence') {
      const v = argv[++i];
      /* v8 ignore next -- invalid cadence is caught by the type system for legit callers */
      if (v === 'immediate' || v === 'scheduled') out.cadence = v;
    }
  }
  return out;
}

export async function run(argv: readonly string[]): Promise<number> {
  const [, , cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '-h' || cmd === '--help') {
    printUsage();
    return cmd === undefined ? 1 : 0;
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
        const githubOutput = process.env.GITHUB_OUTPUT;
        if (githubOutput) {
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
      case 'doctor': {
        const report = await doctor({
          cwd: flags.cwd,
          /* v8 ignore next -- --config test covered via plan arm */
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
          checkArtifacts: flags.artifacts,
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(report) + '\n');
        } else {
          for (const p of report.packages) {
            const badge = p.auth === 'missing' ? '✗' : '✓';
            process.stdout.write(`  ${badge} ${p.name} (${p.kind}) — auth: ${p.auth}\n`);
          }
          if (report.artifacts && report.artifacts.length > 0) {
            process.stdout.write('\nArtifacts:\n');
            for (const a of report.artifacts) {
              const badge = a.present ? '✓' : '✗';
              const suffix = a.present ? '' : `  (expected: ${a.expected})`;
              process.stdout.write(`  ${badge} ${a.artifact_name} (${a.target})${suffix}\n`);
            }
          }
          if (report.issues.length > 0) {
            process.stdout.write('\nIssues:\n');
            for (const i of report.issues) {
              process.stdout.write(`  - ${i}\n`);
            }
          } else {
            process.stdout.write('\nAll checks passed.\n');
          }
        }
        return report.ok ? 0 : 1;
      }
      case 'preflight': {
        const report = await runPreflight({
          cwd: flags.cwd,
          /* v8 ignore next -- --config already covered via plan arm */
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
          all: flags.all,
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(report) + '\n');
        } else {
          if (report.checks.length === 0) {
            process.stdout.write('preflight: no packages in scope\n');
          } else {
            for (const c of report.checks) {
              const badge = c.status === 'ok' ? '✓' : c.status === 'skip' ? '·' : '✗';
              const detail = c.detail ? `  — ${c.detail}` : '';
              process.stdout.write(`  ${badge} ${c.package} (${c.kind}) ${c.check}${detail}\n`);
            }
          }
          if (report.issues.length > 0) {
            process.stdout.write('\nIssues:\n');
            for (const i of report.issues) {
              process.stdout.write(`  - ${i}\n`);
            }
          }
          process.stdout.write(report.ok ? '\npreflight: ok\n' : '\npreflight: fail\n');
        }
        return report.ok ? 0 : 1;
      }
      case 'init': {
        const r = init({
          cwd: flags.cwd,
          force: flags.force,
          ...(flags.cadence !== undefined ? { cadence: flags.cadence } : {}),
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(r) + '\n');
        } else {
          for (const f of r.wrote) process.stdout.write(`  wrote    ${f}\n`);
          for (const f of r.backedUp) process.stdout.write(`  backed up ${f} -> ${f}.bak\n`);
          for (const f of r.skipped) process.stdout.write(`  skipped  ${f} (exists; use --force)\n`);
        }
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
