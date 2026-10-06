import { buildSubprocessEnv, nonEmpty } from '../env.js';
import type { Ctx } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { isPlatformPublished } from './is-platform-published.js';
import { looksLikePublishOverRace } from './looks-like-publish-over-race.js';
import { matchTlogDuplicate } from './match-tlog-duplicate.js';
import type { PlatformPkg } from './npm-platform.js';
import { readStagedIdentity } from './read-staged-identity.js';

export async function publishPlatformPackage(stagingDir: string, pkg: PlatformPkg, ctx: Ctx): Promise<void> {
  const registryOverride = nonEmpty(ctx.env.PIOT_NPM_REGISTRY) ?? nonEmpty(process.env.PIOT_NPM_REGISTRY);
  const hasOidc =
    !registryOverride &&
    Boolean(
      nonEmpty(ctx.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ??
        nonEmpty(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
    );
  const access = pkg.access ?? 'public';
  const args: string[] = ['publish', `--access=${access}`];
  if (pkg.tag) {args.push(`--tag=${pkg.tag}`);}
  if (hasOidc) {args.push('--provenance');}
  if (registryOverride) {args.push(`--registry=${registryOverride}`);}
  args.push(stagingDir);

  try {
    await execCapture('npm', args, {
      cwd: pkg.path,
      env: buildSubprocessEnv(ctx.env),
    });
  } catch (err) {
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
    if (looksLikePublishOverRace(stderr)) {
      return;
    }
    const tlogStderr = matchTlogDuplicate(stderr);
    if (tlogStderr !== null) {
      const staged = await readStagedIdentity(stagingDir);
      if (await isPlatformPublished(staged.name, staged.version, ctx)) {
        return;
      }
      throw new Error(
        `npm publish (platform) failed: Sigstore transparency-log dedupe ` +
          `(TLOG_CREATE_ENTRY_ERROR) and ${staged.name}@${staged.version} is not ` +
          `on the registry — npm's provenance retry re-submitted an identical ` +
          `attestation. Re-run the release to mint a fresh attestation.` +
          `\n${tlogStderr}`,
        { cause: err },
      );
    }
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `npm publish (platform) failed${stderr ? `:\n${stderr}` : `: ${base}`}`,
      { cause: err },
    );
  }
}
