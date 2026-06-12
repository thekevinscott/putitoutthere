/**
 * `putitoutthere` CLI entry. Internal seam — the reusable workflow
 * (`.github/workflows/release.yml`) invokes this. Not a consumer-
 * facing surface; flags / help text are stable enough to test, but
 * not promised externally. See `notes/design-commitments.md`.
 *
 * Commands:
 *   plan           — compute and emit the release plan
 *   publish        — execute the plan against the registries
 *   check          — pre-merge configuration validation (#319). Runs every
 *                    check knowable from the consumer's repo state alone.
 *                    Internal — invoked by the pre-merge reusable workflow;
 *                    not surfaced in user-facing docs per non-goal #7.
 *   write-version  — bump a package's manifest to a planned version
 *                    (pre-build hook for maturin; #276)
 *   write-crate-version — bump a crate's Cargo.toml to a planned
 *                    version (pre-build hook for npm bundled-cli; #366)
 *   version        — print CLI version
 *
 * Global flags:
 *   --cwd <path>      working directory (default: process.cwd())
 *   --config <path>   path to putitoutthere.toml
 *   --json            machine-readable output
 *
 * `plan` / `publish` flags:
 *   --release-packages <spec>  manual-release spec; bypasses change
 *                    detection and plans exactly the named packages
 *
 * `write-version` flags:
 *   --path <dir>      package directory (where pyproject.toml lives)
 *   --version <v>     planned version to write
 *
 * `--dry-run` was removed deliberately (#244). The library's job is
 * publishing; a non-publishing mode of the publish command was a
 * coverage hole pretending to be a feature. Passing `--dry-run` now
 * errors out.
 */

import { isAbsolute, resolve } from 'node:path';

import { runChecks } from './check.js';
import { plan } from './plan.js';
import { publish } from './publish.js';
import { computeStatus, formatStatusRow } from './status.js';
import { writeCrateVersionForBuild } from './write-crate-version.js';
import { writeLauncherFromConfig } from './write-launcher.js';
import { writeVersionForBuild } from './write-version.js';
import { VERSION } from './version.js';

const COMMANDS = [
  'plan',
  'publish',
  'check',
  'status',
  'write-version',
  'write-crate-version',
  'write-launcher',
  'version',
] as const;
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
      '  plan           Compute and emit the release plan',
      '  publish        Execute the plan',
      '  check          Pre-merge configuration validation (#319)',
      '  status         Report registry-vs-tag drift (read-only; #403)',
      '  write-version  Bump a package manifest to the planned version (pre-build; #276)',
      '  write-crate-version  Bump a crate Cargo.toml to the planned version (pre-build; #366)',
      '  write-launcher Generate the bundled-cli npm launcher script (pre-build; #299)',
      '  version        Print CLI version',
      '',
      'Options:',
      '  --cwd <path>      working directory',
      '  --config <path>   path to putitoutthere.toml',
      '  --path <dir>      package or crate directory (write-version / write-crate-version)',
      '  --version <v>     planned version (write-version / write-crate-version)',
      '  --release-packages <spec>  manual-release spec (plan / publish)',
      '  --check           exit non-zero when status finds drift',
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
  json: boolean;
  // `status --check`: exit non-zero when the report finds drift, so it
  // can gate CI. Inert on other commands.
  check: boolean;
  // #276 write-version inputs. Optional on the global flags type
  // because they're only meaningful for that subcommand; the dispatch
  // arm validates presence before use.
  path?: string | undefined;
  version?: string | undefined;
  // Manual-release spec for `plan` / `publish`. Forwarded to the
  // planner; absent => normal change-detected planning.
  releasePackages?: string | undefined;
}

export function parseFlags(argv: readonly string[]): ParsedFlags {
  const out: ParsedFlags = {
    cwd: process.cwd(),
    json: false,
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    /* v8 ignore next -- ?? fallback is for malformed argv; tests always pass the value */
    if (a === '--cwd') {out.cwd = argv[++i] ?? out.cwd;}
    else if (a === '--config') {out.config = argv[++i];}
    else if (a === '--json') {out.json = true;}
    else if (a === '--check') {out.check = true;}
    else if (a === '--path') {out.path = argv[++i];}
    else if (a === '--version') {out.version = argv[++i];}
    else if (a === '--release-packages') {out.releasePackages = argv[++i];}
    else if (a === '--dry-run') {
      // Removed in #244. Publishing is the library's only job; a
      // non-publishing flavor of `publish` is a coverage hole, not
      // a feature. Fail loudly so callers update their invocation.
      throw new Error(
        '--dry-run was removed. The CLI does not support a non-publishing publish mode; remove the flag from your invocation.',
      );
    }
  }
  // Always normalise --cwd to an absolute path. Downstream code joins
  // `cwd` with `artifacts/` to derive paths it then hands to subprocesses
  // (twine, cargo, npm) running with `cwd: ctx.cwd`. If cwd were left
  // relative — e.g. `--cwd fixture-tree` from the JS action — those
  // file paths would resolve as `fixture-tree/fixture-tree/...` from
  // the subprocess's vantage. Anchor here once.
  if (!isAbsolute(out.cwd)) {out.cwd = resolve(out.cwd);}
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

  try {
    const flags = parseFlags(rest);
    switch (cmd) {
      case 'plan': {
        const matrix = await plan({
          cwd: flags.cwd,
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
          releasePackages: flags.releasePackages,
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
      case 'check': {
        // #319: pre-merge config validation. Aggregates every finding
        // in one round-trip rather than failing on the first so a
        // consumer fixes the whole config in one push. Exits non-zero
        // when any finding lands; CI surfaces the same vocabulary the
        // publish-phase `require*` helpers use.
        const findings = runChecks({
          cwd: flags.cwd,
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify({ findings }) + '\n');
        } else if (findings.length === 0) {
          process.stdout.write('check: no findings\n');
        } else {
          process.stderr.write(
            `putitoutthere check: ${findings.length} finding${findings.length === 1 ? '' : 's'}.\n\n`,
          );
          for (const f of findings) {
            const prefix = f.package ? `  - ${f.package}: ` : '  - ';
            process.stderr.write(`${prefix}${f.message}\n`);
          }
        }
        return findings.length === 0 ? 0 : 1;
      }
      case 'status': {
        // #403: read-only registry-vs-tag drift report. Reuses the same
        // `lastTag` resolver and per-kind `latestVersion` handler the
        // release path uses, so the report can't disagree with reality.
        // `--check` makes drift a non-zero exit (a CI gate); without it
        // status is a pure report that always exits 0.
        const rows = await computeStatus({
          cwd: flags.cwd,
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
        });
        if (flags.json) {
          process.stdout.write(JSON.stringify(rows) + '\n');
        } else {
          for (const row of rows) {
            process.stdout.write(formatStatusRow(row) + '\n');
          }
        }
        return flags.check && rows.some((r) => r.drift) ? 1 : 0;
      }
      case 'write-launcher': {
        // #299: pre-build hook used by `_matrix.yml`'s npm bundled-cli
        // main row. Authors `bin/<bin>.js` + `package.json#bin` in
        // place; consumer overrides are preserved. No-op for non-npm
        // packages and for npm packages without a bundled-cli build
        // entry, so the build job can invoke this on every main row.
        if (!flags.path) {throw new Error('write-launcher: --path <pkg-dir> is required');}
        const written = writeLauncherFromConfig({
          cwd: flags.cwd,
          packagePath: flags.path,
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
        });
        if (written.length === 0) {
          process.stdout.write(`write-launcher: ${flags.path}: no-op (not a bundled-cli npm package, or files exist)\n`);
        } else {
          process.stdout.write(
            `write-launcher: ${flags.path}: wrote ${written.join(', ')}\n`,
          );
        }
        return 0;
      }
      case 'write-version': {
        // #276: pre-build hook used by `_matrix.yml`'s maturin steps.
        // Maturin reads the version from disk at build time with no
        // env override, so the manifest must match the planned
        // version before maturin runs. crates / npm bump at publish;
        // setuptools-scm / hatch-vcs use SETUPTOOLS_SCM_PRETEND_VERSION.
        if (!flags.path) {throw new Error('write-version: --path <pkg-dir> is required');}
        if (!flags.version) {throw new Error('write-version: --version <v> is required');}
        const target = isAbsolute(flags.path) ? flags.path : resolve(flags.cwd, flags.path);
        const written = writeVersionForBuild(target, flags.version);
        process.stdout.write(
          `write-version: ${target} → ${flags.version}; wrote ${written.join(', ')}\n`,
        );
        return 0;
      }
      case 'write-crate-version': {
        // #366: pre-build hook used by `_matrix.yml`'s npm bundled-cli
        // steps. `cargo build` bakes CARGO_PKG_VERSION from the crate's
        // Cargo.toml at compile time with no env override, so the
        // manifest must match the planned version before the
        // cross-compile runs — otherwise the bundled binary reports the
        // stale on-disk literal from `--version`.
        if (!flags.path) {throw new Error('write-crate-version: --path <crate-dir> is required');}
        if (!flags.version) {throw new Error('write-crate-version: --version <v> is required');}
        const target = isAbsolute(flags.path) ? flags.path : resolve(flags.cwd, flags.path);
        const written = writeCrateVersionForBuild(target, flags.version);
        process.stdout.write(
          `write-crate-version: ${target} → ${flags.version}; wrote ${written.join(', ')}\n`,
        );
        return 0;
      }
      case 'publish': {
        const result = await publish({
          cwd: flags.cwd,
          /* v8 ignore next -- --config test covered in plan arm; publish shares the same plumbing */
          ...(flags.config !== undefined ? { configPath: flags.config } : {}),
          releasePackages: flags.releasePackages,
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
