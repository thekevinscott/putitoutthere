import { rm } from 'node:fs/promises';

import type { Ctx } from '../types.js';
import { nonEmpty } from '../env.js';
import { awaitPlatformsVisible } from './await-platforms-visible.js';
import { isPlatformPublished } from './is-platform-published.js';
import type { PlatformPkg } from './npm-platform.js';
import { publishPlatformPackage } from './publish-platform-package.js';
import { resolvePlatformName } from './resolve-platform-name.js';
import { rewriteOptionalDependencies } from './rewrite-optional-dependencies.js';
import { synthesizePlatformPackage } from './synthesize-platform-package.js';

/**
 * Publish every per-platform package across every build entry, then
 * rewrite the main package.json to add `optionalDependencies`. Returns
 * the list of published platform names so the caller can log them.
 *
 * On any failure, throws before the main package.json is modified.
 */
export async function publishPlatforms(
  pkg: PlatformPkg,
  version: string,
  ctx: Ctx,
): Promise<{ published: string[]; skipped: string[] }> {
  const mainName = pkg.npm ?? pkg.name;
  const published: string[] = [];
  const skipped: string[] = [];
  const isMulti = pkg.build.length > 1;

  for (const entry of pkg.build) {
    for (const target of pkg.targets) {
      const platformName = resolvePlatformName(entry.name, {
        name: mainName,
        triple: target,
        mode: entry.mode,
      });
      if (await isPlatformPublished(platformName, version, ctx)) {
        skipped.push(platformName);
        continue;
      }
      const stagingDir = await synthesizePlatformPackage(
        pkg,
        entry,
        target,
        platformName,
        version,
        ctx,
        isMulti,
      );
      try {
        await publishPlatformPackage(stagingDir, pkg, ctx);
        published.push(platformName);
      } finally {
        // Cleanup is best-effort. The publish already happened, and the
        // all-or-nothing-per-package guarantee is about the publish, not
        // the staging tempdir. Awaiting `rm` in `finally` would let a
        // cleanup rejection (EBUSY/EPERM on Windows runners even with
        // force:true) REPLACE the block's outcome and mask a successful
        // publish, misreporting `published`. Swallow the failure with a
        // warning instead — a leaked tempdir on an ephemeral runner is
        // genuinely cosmetic; the already-published artifact is what
        // matters.
        try {
          await rm(stagingDir, { recursive: true, force: true });
        } catch (err) {
          ctx.log.warn(
            `failed to clean up platform staging directory ${stagingDir}`,
            { error: err },
          );
        }
      }
    }
  }

  const registryOverride = nonEmpty(ctx.env.PIOT_NPM_REGISTRY) ?? nonEmpty(process.env.PIOT_NPM_REGISTRY);
  await awaitPlatformsVisible(published, version, registryOverride);

  await rewriteOptionalDependencies(pkg, version, [...published, ...skipped]);

  return { published, skipped };
}
