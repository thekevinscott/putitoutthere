/**
 * npm handler — vanilla mode.
 *
 * Issue #18. Plan: §7.4, §12.2 (vanilla), §13.1, §14.5, §16.1.
 *
 * The matrix-using modes (napi, bundled-cli) layer on top of this in
 * #19; they share isPublished and writeVersion, and add a platform-
 * package orchestration step before the main publish.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Ctx, Handler, PublishResult } from '../types.js';
import { publishPlatforms, type PlatformPkg } from './npm-platform.js';
import { nonEmpty } from '../env.js';
import { USER_AGENT } from '../version.js';

type NpmPkg = {
  name: string;
  path: string;
  npm?: string;
  access?: 'public' | 'restricted';
  tag?: string;
  build?: 'napi' | 'bundled-cli';
  targets?: readonly string[];
};

function npmNameFor(pkg: NpmPkg): string {
  return pkg.npm ?? pkg.name;
}

function isPublishedImpl(pkg: NpmPkg, version: string, ctx: Ctx): Promise<boolean> {
  const name = npmNameFor(pkg);
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      cwd: ctx.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return Promise.resolve(true);
  } catch {
    // `npm view` exits non-zero when the version doesn't exist.
    // We treat every non-zero as "not published"; the subsequent
    // publish step will surface real auth/network errors there.
    return Promise.resolve(false);
  }
}

function writeVersionImpl(pkg: NpmPkg, version: string, _ctx: Ctx): Promise<string[]> {
  const p = join(pkg.path, 'package.json');
  let original: string;
  try {
    original = readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Promise.reject(new Error(`package.json not found at ${p}`));
    }
    /* v8 ignore next -- non-ENOENT read errors surface as-is */
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(original) as Record<string, unknown>;
  } catch (err) {
    return Promise.reject(
      new Error(`package.json JSON parse error: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
  if (parsed.version === version) return Promise.resolve([]);
  parsed.version = version;
  // Preserve the existing indentation shape (2-space default if we
  // can't detect) and the trailing newline when present.
  const indent = detectIndent(original);
  const trailing = original.endsWith('\n') ? '\n' : '';
  writeFileSync(p, JSON.stringify(parsed, null, indent) + trailing, 'utf8');
  return Promise.resolve([p]);
}

async function publishImpl(pkg: NpmPkg, version: string, ctx: Ctx): Promise<PublishResult> {
  if (await isPublishedImpl(pkg, version, ctx)) {
    return { status: 'already-published' };
  }
  if (ctx.dryRun) {
    return { status: 'skipped' };
  }

  // napi / bundled-cli: publish platform packages first, then rewrite
  // the main package.json to add optionalDependencies, then fall through
  // to the normal main-package publish path below. §13.7.
  if (
    (pkg.build === 'napi' || pkg.build === 'bundled-cli') &&
    pkg.targets !== undefined &&
    pkg.targets.length > 0
  ) {
    const platformPkg: PlatformPkg = {
      name: pkg.name,
      path: pkg.path,
      npm: pkg.npm,
      access: pkg.access,
      tag: pkg.tag,
      build: pkg.build,
      targets: pkg.targets,
    };
    await publishPlatforms(platformPkg, version, ctx);
  }

  const hasOidc = Boolean(
    nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ??
      nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
  );

  // npm provenance requires a `repository` field in package.json
  // that matches the git remote. Failing loud here is strictly better
  // than letting npm publish fail at the end with a confusing error.
  if (hasOidc) {
    assertRepositoryField(pkg.path);
  }

  const access = pkg.access ?? 'public';
  const args: string[] = ['publish', `--access=${access}`];
  if (pkg.tag) args.push(`--tag=${pkg.tag}`);
  if (hasOidc) args.push('--provenance');

  try {
    execFileSync('npm', args, {
      cwd: pkg.path,
      env: {
        ...process.env,
        ...ctx.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    const base = err instanceof Error ? err.message : String(err);
    const name = npmNameFor(pkg);
    // npm trusted publishing (OIDC) requires the package to already
    // exist on the registry; the first-ever publish must go through a
    // token. Detect that exact shape — auth failure + OIDC in play +
    // package not on the registry — and surface a bootstrap hint
    // before the generic stderr dump.
    if (hasOidc && looksLikeAuthFailure(stderr)) {
      if (await isBootstrapPublish(name)) {
        throw new Error(
          [
            `npm publish: package "${name}" does not exist on registry.npmjs.org yet.`,
            'npm trusted publishing requires the package to exist first.',
            'Bootstrap by setting NODE_AUTH_TOKEN for the first publish; you can migrate to trusted publishing afterwards.',
          ].join('\n'),
          { cause: err },
        );
      }
    }
    throw new Error(`npm publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`, { cause: err });
  }

  return {
    status: 'published',
    url: `https://www.npmjs.com/package/${npmNameFor(pkg)}/v/${version}`,
  };
}

/* ------------------------------ internals ------------------------------ */

function assertRepositoryField(path: string): void {
  const pkgJsonPath = join(path, 'package.json');
  const raw = readFileSync(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(raw) as { repository?: unknown };
  if (!pkg.repository) {
    throw new Error(
      'npm publish --provenance requires a `repository` field in package.json',
    );
  }
}

/** Heuristic match on npm's auth-related stderr shapes. */
function looksLikeAuthFailure(stderr: string | undefined): boolean {
  if (!stderr) return false;
  return /\b(E401|E403|ENEEDAUTH|EAUTH|need auth|not authori[sz]ed|unauthorized|forbidden)\b/i.test(
    stderr,
  );
}

/**
 * Returns true when the package does not yet exist on the registry
 * (any 404-equivalent from the packument endpoint). Non-404 responses
 * — including network failures and timeouts — return false so we
 * don't misclassify transient errors as the bootstrap case.
 *
 * The fetch is bounded by a 5s AbortSignal.timeout (#142). The hint is
 * advisory: a slow or unreachable registry should fall through to
 * "not a bootstrap publish" rather than hanging the action.
 */
export async function isBootstrapPublish(name: string): Promise<boolean> {
  try {
    // The npm registry expects scoped packages as `@scope%2Fname`: the
    // `@` prefix stays literal, `/` stays percent-encoded. Unscoped
    // names have no `@` at all. `replaceAll` keeps the transform safe
    // against pathological input even though encodeURIComponent can
    // only produce `%40` at the start of a valid npm name.
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name).replaceAll('%40', '@')}`,
      {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      },
    );
    return res.status === 404;
  } catch {
    // Network failure, timeout, DNS error — treat as "not a bootstrap"
    // so the caller falls through to the generic auth-error message
    // rather than hanging or surfacing a misleading hint.
    return false;
  }
}

/** 2 / 4 / tab. Defaults to 2 when undetectable. */
function detectIndent(source: string): number | string {
  const m = /^(?<indent>[ \t]+)"/m.exec(source);
  /* v8 ignore next -- JSON.parse of valid JSON always has at least one indented line when pretty-printed */
  if (!m?.groups?.indent) return 2;
  const indent = m.groups.indent;
  if (indent.includes('\t')) return '\t';
  return indent.length;
}

export const npm: Handler = {
  kind: 'npm',
  isPublished: isPublishedImpl as Handler['isPublished'],
  writeVersion: writeVersionImpl as Handler['writeVersion'],
  publish: publishImpl as Handler['publish'],
};
