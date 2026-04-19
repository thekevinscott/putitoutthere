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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Ctx, Handler, PublishResult } from '../types.js';

type NpmPkg = {
  name: string;
  path: string;
  npm?: string;
  access?: 'public' | 'restricted';
  tag?: string;
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
  if (!existsSync(p)) {
    return Promise.reject(new Error(`package.json not found at ${p}`));
  }
  const original = readFileSync(p, 'utf8');
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

  const hasOidc = Boolean(
    ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
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
    throw new Error(`npm publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`);
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
