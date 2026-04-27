/**
 * `putitoutthere publish` — the big integration.
 *
 * Flow per plan.md §13:
 *  1. Re-run plan (registry state may have moved since build).
 *  2. Pre-flight auth check (#14). Abort on any missing creds.
 *  3. Artifact completeness check (#13). Abort per-package on missing
 *     targets.
 *  4. For each package (in cascade / depends-on order):
 *       writeVersion → handler.publish → git tag + push.
 *  5. On handler failure: verbose dump (#15); re-throw and stop.
 *
 * No-push tag model (§13.6): tag points at the merge commit; no bump
 * commit is pushed to main.
 *
 * Issue #22.
 */

import { isAbsolute, join, resolve } from 'node:path';

import { loadConfig, type Package } from './config.js';
import { checkCompleteness, type MatrixRow as CompletenessRow } from './completeness.js';
import { createTag, headCommit, pushTag } from './git.js';
import { handlerFor as defaultHandlerFor } from './handlers/index.js';
import { createLogger } from './log.js';
import { plan, type MatrixRow } from './plan.js';
import { formatTag } from './tag-template.js';
import { requireAuth } from './preflight.js';
import { withRetry } from './retry.js';
import type { Ctx, Handler, PublishResult } from './types.js';
import { dumpFailure } from './verbose.js';

export interface PublishOptions {
  cwd: string;
  configPath?: string;
  dryRun?: boolean;
  /** Override for tests. */
  handlerFor?: (kind: Handler['kind']) => Handler;
}

export interface PublishOutput {
  ok: boolean;
  published: Array<{ package: string; version: string; result: PublishResult }>;
}

export async function publish(opts: PublishOptions): Promise<PublishOutput> {
  const cwd = opts.cwd;
  /* v8 ignore next -- tests always set explicit paths */
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const config = loadConfig(cfgPath);
  // Handlers do `readFileSync(join(pkg.path, 'Cargo.toml'))` etc, which
  // resolves against process.cwd(). For self-publish that matches the
  // repo root, but tools that invoke the CLI with `--cwd` (e2e harness,
  // monorepo orchestrators) live elsewhere. Anchor pkg.path to opts.cwd
  // up front so every downstream fs op points at the right tree.
  for (const p of config.packages) {
    if (!isAbsolute(p.path)) p.path = resolve(cwd, p.path);
  }
  /* v8 ignore next -- tests always inject handlerFor */
  const handlerFor = opts.handlerFor ?? defaultHandlerFor;
  const log = createLogger();

  // 1. Re-run plan.
  const matrix = await plan({ cwd, configPath: cfgPath });
  if (matrix.length === 0) {
    log.info('publish: plan is empty; nothing to release');
    return { ok: true, published: [] };
  }

  // Collapse matrix rows back into per-package entries. Multiple rows
  // per package (one per target) share a single version.
  const perPackage = groupByPackage(matrix, config.packages);

  // 2. Pre-flight auth: every selected package must have a viable
  //    auth path (OIDC env or env-var token) before any side effects.
  const selectedPackages = [...perPackage.keys()].map((name) => mustGet(config.packages, name));
  requireAuth(selectedPackages);

  // 3. Artifact completeness, unless dry-run (no artifacts to check).
  if (!opts.dryRun) {
    const completeness = checkCompleteness(matrix as CompletenessRow[], artifactsRoot(cwd));
    const incomplete = [...completeness.entries()].filter(([, r]) => !r.ok);
    if (incomplete.length > 0) {
      const lines = ['Artifact completeness check failed:'];
      for (const [name, r] of incomplete) {
        for (const m of r.missing) {
          lines.push(`  ${name} / ${m.row.target}: ${m.reason}`);
        }
      }
      throw new Error(lines.join('\n'));
    }
  }

  // 4. Publish each package in dep-graph order.
  const published: PublishOutput['published'] = [];
  const head = headCommit({ cwd });
  const order = publishOrder(config.packages, [...perPackage.keys()]);

  for (const name of order) {
    const pkg = mustGet(config.packages, name);
    const rows = perPackage.get(name)!;
    const version = rows[0]!.version;
    const handler = handlerFor(pkg.kind);
    const ctx: Ctx = {
      cwd,
      dryRun: Boolean(opts.dryRun),
      log,
      env: process.env as Record<string, string>,
      artifacts: {
        get: (n) => join(artifactsRoot(cwd), n),
        has: () => true, // completeness check already ran
      },
      artifactsRoot: artifactsRoot(cwd),
    };

    try {
      if (await withRetry(() => handler.isPublished(pkg, version, ctx))) {
        log.info(`publish: ${name}@${version} already published; skipping`);
        continue;
      }
      if (opts.dryRun) {
        // Dry-run stops before any side effect, including writeVersion
        // (which edits the CI worktree) and publish itself. Reporters
        // still see the package in the "would publish" list.
        log.info(`publish: DRY-RUN would publish ${name}@${version}`);
        published.push({ package: name, version, result: { status: 'skipped' } });
        continue;
      }
      await handler.writeVersion(pkg, version, ctx);
      const result = await withRetry(() => handler.publish(pkg, version, ctx));
      published.push({ package: name, version, result });

      if (result.status === 'published') {
        const tagName = formatTag(pkg.tag_format, { name, version });
        createTag(tagName, head, { cwd, message: `Release ${tagName}` });
        try {
          pushTag(tagName, { cwd });
        } catch (err) {
          /* v8 ignore next -- local tests use a throwaway repo without a remote */
          log.warn(`publish: failed to push tag ${tagName}: ${err instanceof Error ? err.message : String(err)}`);
        }
        // GitHub Release creation is the reusable workflow's job
        // (`gh release create --generate-notes` after this step). The
        // engine cuts the tag and stops.
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dumpFailure(
        error,
        {
          package: name,
          handler: pkg.kind,
          command: [],
          stdout: '',
          stderr: error.message,
          exitCode: -1,
        },
        // Thread ctx.env through so handler-injected credentials (OIDC-
        // minted twine/npm/crates tokens that live only on ctx.env, not
        // process.env) are redacted in the rendered job-summary. #195.
        { log, envSources: [ctx.env as Record<string, string | undefined>] },
      );
      throw error;
    }
  }

  return { ok: true, published };
}

/* ----------------------------- internals ----------------------------- */

function artifactsRoot(cwd: string): string {
  return join(cwd, 'artifacts');
}

function mustGet(packages: readonly Package[], name: string): Package {
  const p = packages.find((x) => x.name === name);
  /* v8 ignore next -- name came from the plan output; always exists */
  if (!p) throw new Error(`publish: unknown package: ${name}`);
  return p;
}

function groupByPackage(
  rows: readonly MatrixRow[],
  _packages: readonly Package[],
): Map<string, MatrixRow[]> {
  const out = new Map<string, MatrixRow[]>();
  for (const r of rows) {
    const arr = out.get(r.name) ?? [];
    arr.push(r);
    out.set(r.name, arr);
  }
  return out;
}

/**
 * Toposort over depends_on so upstream packages publish before
 * downstream ones that depend on them. Cycle detection already
 * happened in cascade; we can assume acyclic.
 */
function publishOrder(packages: readonly Package[], selected: readonly string[]): string[] {
  const inSet = new Set(selected);
  const deps = new Map<string, string[]>();
  for (const p of packages) {
    if (inSet.has(p.name)) {
      deps.set(
        p.name,
        (p.depends_on ?? []).filter((d) => inSet.has(d)),
      );
    }
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const d of deps.get(name) ?? []) visit(d);
    order.push(name);
  };
  for (const n of selected) visit(n);
  return order;
}
