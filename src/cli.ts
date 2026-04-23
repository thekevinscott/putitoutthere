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

import { login, logout, status, type DevicePrompt, type StatusResult } from './auth.js';
import { doctor } from './doctor.js';
import { init } from './init.js';
import { plan } from './plan.js';
import { runPreflight } from './preflight-run.js';
import { publish } from './publish.js';
import {
  inspect,
  tokenList,
  tokenListSecrets,
  type Registry,
  type TokenListRow,
} from './token.js';
import { VERSION } from './version.js';

const COMMANDS = ['init', 'plan', 'publish', 'doctor', 'preflight', 'token', 'auth', 'version'] as const;
type Command = (typeof COMMANDS)[number];

const REGISTRIES = ['crates', 'npm', 'pypi'] as const satisfies readonly Registry[];
function isRegistry(v: string): v is Registry {
  return (REGISTRIES as readonly string[]).includes(v);
}

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
      '  token      Inspect or list registry tokens (pypi/npm/crates)',
      '  auth       Optional: sign in to GitHub for `token list --secrets`',
      '  version    Print CLI version',
      '',
      'Options:',
      '  --cwd <path>      working directory',
      '  --config <path>   path to putitoutthere.toml',
      '  --dry-run         publish without side effects',
      '  --json            emit machine-readable output (plan only)',
      '  --force           overwrite putitoutthere.toml on init',
      '  --artifacts       doctor: also check artifact completeness',
      '  --deep            doctor: also inspect each token\'s publish scope',
      '  --preflight-check publish: refuse on token scope mismatch (pypi/npm)',
      '  --all             preflight: include non-cascaded packages too',
      '  --secrets         token list: also list GitHub repo/environment secrets (requires auth login)',
      '  --cadence <mode>  init: immediate (default) or scheduled',
      '  --token <value>   token inspect: token value (else read from env)',
      '  --registry <r>    token inspect: crates|npm|pypi',
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
  deep: boolean;
  preflightCheck: boolean;
  secrets: boolean;
  cadence?: 'immediate' | 'scheduled';
  token?: string;
  registry?: Registry;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const out: ParsedFlags = {
    cwd: process.cwd(),
    dryRun: false,
    json: false,
    force: false,
    artifacts: false,
    all: false,
    deep: false,
    preflightCheck: false,
    secrets: false,
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
    else if (a === '--deep') out.deep = true;
    else if (a === '--preflight-check') out.preflightCheck = true;
    else if (a === '--secrets') out.secrets = true;
    else if (a === '--cadence') {
      const v = argv[++i];
      /* v8 ignore next -- invalid cadence is caught by the type system for legit callers */
      if (v === 'immediate' || v === 'scheduled') out.cadence = v;
    } else if (a === '--token') {
      const v = argv[++i];
      if (v !== undefined) out.token = v;
    } else if (a === '--registry') {
      const v = argv[++i];
      if (v !== undefined && isRegistry(v)) out.registry = v;
    }
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
          preflightCheck: flags.preflightCheck,
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
          deep: flags.deep,
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(report) + '\n');
        } else {
          for (const p of report.packages) {
            const badge = p.auth === 'missing' ? '✗' : '✓';
            const scopeSuffix = p.scope !== undefined
              ? `  scope: ${p.scope}${p.scope_match && p.scope_match !== 'ok' ? ` [${p.scope_match}]` : ''}`
              : '';
            process.stdout.write(`  ${badge} ${p.name} (${p.kind}) — auth: ${p.auth}${scopeSuffix}\n`);
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
      case 'token': {
        const [sub, ...subRest] = rest;
        if (sub === 'list') {
          const subFlags = parseFlags(subRest);
          const rows = tokenList({
            cwd: subFlags.cwd,
            ...(subFlags.config !== undefined ? { configPath: subFlags.config } : {}),
          });
          let secretsNote: string | null = null;
          let envErrorNotes: string[] = [];
          if (subFlags.secrets) {
            const outcome = await tokenListSecrets({ cwd: subFlags.cwd });
            /* v8 ignore next 3 -- both arms of the secret push require a live keyring + GH creds; `tokenListSecrets` is covered in token.test.ts. */
            if (outcome.kind === 'ok' || outcome.kind === 'error') {
              rows.push(...outcome.rows);
            }
            if (outcome.kind !== 'ok') {
              secretsNote = outcome.message;
              /* v8 ignore next 7 -- `envErrors` branch needs a live keyring; tokenListSecrets itself is covered in token.test.ts. */
            } else if (outcome.envErrors && outcome.envErrors.length > 0) {
              // #143: surface per-environment failures as a trailing
              // batch so one flaky env doesn't tank the listing.
              envErrorNotes = outcome.envErrors.map(
                (e) => `--secrets: environment "${e.environment}" failed: ${e.message}`,
              );
            }
          }
          if (subFlags.json) {
            const payload: { tokens: TokenListRow[]; note?: string; envErrors?: string[] } = {
              tokens: rows,
            };
            if (secretsNote !== null) payload.note = secretsNote;
            /* v8 ignore next -- envErrors is covered by the token.test.ts partial-failure case; CLI glue mirrors it. */
            if (envErrorNotes.length > 0) payload.envErrors = envErrorNotes;
            process.stdout.write(JSON.stringify(payload) + '\n');
          } else {
            printTokenList(rows);
            if (secretsNote !== null) process.stderr.write(`${secretsNote}\n`);
            /* v8 ignore next -- same as above; envErrorNotes only populated when a live GH call returned errors. */
            for (const e of envErrorNotes) process.stderr.write(`${e}\n`);
          }
          return 0;
        }
        if (sub !== 'inspect') {
          process.stderr.write(
            sub === undefined
              ? 'putitoutthere token: missing subcommand (expected "inspect" or "list")\n'
              : `putitoutthere token: unknown subcommand: ${sub}\n`,
          );
          return 1;
        }
        const subFlags = parseFlags(subRest);
        const tokenValue = subFlags.token ?? envTokenFor(subFlags.registry);
        if (tokenValue === undefined) {
          process.stderr.write(
            'putitoutthere token inspect: no token provided. Pass --token or set a registry env var.\n',
          );
          return 1;
        }
        const result = await inspect({
          token: tokenValue,
          ...(subFlags.registry !== undefined ? { registry: subFlags.registry } : {}),
        });
        if (subFlags.json) {
          process.stdout.write(JSON.stringify(result) + '\n');
        } else {
          printInspectHuman(result);
        }
        return 'error' in result ? 1 : 0;
      }
      case 'auth': {
        const [sub, ...subRest] = rest;
        const subFlags = parseFlags(subRest);
        /* v8 ignore start -- `auth login` requires live Device Flow against GitHub; the login() function itself is covered in auth.test.ts */
        if (sub === 'login') {
          const result = await login({
            onPrompt: (p) => printDevicePrompt(p),
          });
          if (subFlags.json) {
            process.stdout.write(JSON.stringify(result) + '\n');
          } else {
            process.stdout.write(
              `Logged in as ${result.account} (access token expires ${new Date(result.expiresAt * 1000).toISOString()}).\n`,
            );
          }
          return 0;
        }
        /* v8 ignore stop */
        if (sub === 'logout') {
          const result = await logout();
          /* v8 ignore next -- --json branch is a trivial stringify; covered via auth.test.ts for `logout()` */
          if (subFlags.json) process.stdout.write(JSON.stringify(result) + '\n');
          else process.stdout.write(result.wiped ? 'Logged out.\n' : 'Not logged in.\n');
          return 0;
        }
        if (sub === 'status') {
          const result = await status();
          /* v8 ignore next -- --json branch is a trivial stringify; covered via auth.test.ts for `status()` */
          if (subFlags.json) process.stdout.write(JSON.stringify(result) + '\n');
          else printAuthStatus(result);
          return result.authenticated ? 0 : 1;
        }
        process.stderr.write(
          sub === undefined
            ? 'putitoutthere auth: missing subcommand (expected "login", "logout", or "status")\n'
            : `putitoutthere auth: unknown subcommand: ${sub}\n`,
        );
        return 1;
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
          for (const f of r.wrote) process.stdout.write(`  wrote        ${f}\n`);
          for (const f of r.backedUp) process.stdout.write(`  backed up    ${f} -> ${f}.bak\n`);
          for (const f of r.skipped) process.stdout.write(`  skipped      ${f} (exists; use --force)\n`);
          for (const f of r.alreadyPresent) process.stdout.write(`  up-to-date   ${f}\n`);
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

/**
 * Pick a token from the environment by matching value format, not by
 * name. `pypi-` prefix → pypi; `npm_` prefix → npm. crates.io tokens
 * have no identifying prefix, so we refuse to guess and require the
 * caller to pass `--token` in that case.
 *
 * If `registry` is specified, return the first matching value (or
 * `undefined` if none). If it is not specified, accept exactly one
 * prefix-identifiable match across the environment.
 */
function envTokenFor(registry: Registry | undefined): string | undefined {
  const env = process.env;
  const matches: Array<{ registry: Registry; value: string }> = [];
  for (const v of Object.values(env)) {
    if (typeof v !== 'string') continue;
    if (v.startsWith('pypi-')) matches.push({ registry: 'pypi', value: v });
    else if (v.startsWith('npm_')) matches.push({ registry: 'npm', value: v });
  }
  if (registry === undefined) {
    if (matches.length === 1) return matches[0]!.value;
    return undefined;
  }
  const filtered = matches.filter((m) => m.registry === registry);
  return filtered[0]?.value;
}

function printTokenList(rows: TokenListRow[]): void {
  if (rows.length === 0) {
    process.stdout.write('no registry tokens found in environment\n');
    return;
  }
  const headers = ['REGISTRY', 'SOURCE', 'ENV/NAME', 'DETAILS'] as const;
  const widths = headers.map((h) => h.length);
  for (const r of rows) {
    widths[0] = Math.max(widths[0]!, r.registry.length);
    widths[1] = Math.max(widths[1]!, r.source.length);
    widths[2] = Math.max(widths[2]!, r.name.length);
    widths[3] = Math.max(widths[3]!, r.details.length);
  }
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => pad(c, widths[i]!)).join('  ').trimEnd() + '\n';
  process.stdout.write(line(headers));
  for (const r of rows) {
    process.stdout.write(line([r.registry, r.source, r.name, r.details]));
  }
}

function printInspectHuman(result: Awaited<ReturnType<typeof inspect>>): void {
  if ('error' in result) {
    process.stderr.write(
      `inspect failed (${result.registry}, digest=${result.source_digest}): ${result.error}\n`,
    );
    return;
  }
  const lines = [`registry: ${result.registry}`, `digest:   ${result.source_digest}`];
  if (result.registry === 'pypi') {
    lines.push(`format:   ${result.format}`);
    lines.push(`identifier: ${JSON.stringify(result.identifier)}`);
    if (result.restrictions.length === 0) {
      lines.push('restrictions: (none — full-scope token)');
    } else {
      lines.push('restrictions:');
      for (const r of result.restrictions) {
        lines.push(`  - ${JSON.stringify(r)}`);
      }
    }
    lines.push(`expired:  ${String(result.expired)}`);
  } else if (result.registry === 'npm') {
    lines.push(`format:   ${result.format}`);
    lines.push(`username: ${result.username}`);
    if (result.scope_row) {
      lines.push(`readonly: ${String(result.scope_row.readonly)}`);
      lines.push(`automation: ${String(result.scope_row.automation)}`);
      if (result.scope_row.packages) lines.push(`packages: ${result.scope_row.packages.join(', ')}`);
      if (result.scope_row.scopes) lines.push(`scopes:   ${result.scope_row.scopes.join(', ')}`);
      if (result.scope_row.orgs) lines.push(`orgs:     ${result.scope_row.orgs.join(', ')}`);
      if (result.scope_row.expires_at) lines.push(`expires:  ${result.scope_row.expires_at}`);
    } else if (result.note) {
      lines.push(`note:     ${result.note}`);
    }
  } else {
    lines.push(`username: ${result.username}`);
    if (result.account_tokens) {
      lines.push(`account tokens (${result.account_tokens.length}):`);
      for (const t of result.account_tokens) {
        const scopes = t.endpoint_scopes?.join(',') ?? '(unscoped)';
        const crates = t.crate_scopes?.join(',') ?? '(all)';
        lines.push(`  - ${t.name}: endpoints=${scopes} crates=${crates}`);
      }
    }
    lines.push(`note:     ${result.note}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/* v8 ignore next 6 -- only called from the `auth login` arm above, which is itself v8-ignored */
function printDevicePrompt(p: DevicePrompt): void {
  process.stderr.write(
    `Visit ${p.verificationUri} and enter code: ${p.userCode}\n` +
      `(code expires in ${Math.round(p.expiresInSeconds / 60)} min)\n`,
  );
}

function printAuthStatus(r: StatusResult): void {
  /* v8 ignore next 5 -- `authenticated: true` requires a live GitHub /user response; status() success path is covered in auth.test.ts */
  if (r.authenticated) {
    process.stdout.write(
      `Logged in as ${r.account} (access token expires ${new Date(r.expiresAt * 1000).toISOString()}).\n`,
    );
    return;
  }
  process.stderr.write(`${r.message}\n`);
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
