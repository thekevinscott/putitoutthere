import { resolveNpmTarballUrl } from '../verify/npm-tarball/resolve-url.js';
import { npmVisibilityBudget } from '../verify/npm-tarball/visibility-budget.js';

export async function awaitPlatformsVisible(
  names: readonly string[],
  version: string,
  registry: string | undefined,
): Promise<void> {
  const budget = npmVisibilityBudget(registry);
  for (const name of names) {
    const url = await resolveNpmTarballUrl(name, version, {
      registry,
      ...budget,
      log: (line) => process.stderr.write(line),
    });
    if (url === null) {
      throw new Error(
        `npm: ${name}@${version} was published but its per-version document never resolved; not publishing the main package, which would install without it`,
      );
    }
  }
}
