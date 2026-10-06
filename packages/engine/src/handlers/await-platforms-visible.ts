import { resolveNpmTarballUrl } from '../verify/npm-tarball/resolve-url.js';

export async function awaitPlatformsVisible(
  names: readonly string[],
  version: string,
  registry: string | undefined,
): Promise<void> {
  const sleeps = registry ? [1, 2, 5, 10] : [5, 15, 30, 60, 120, 180, 300];
  for (const name of names) {
    const url = await resolveNpmTarballUrl(name, version, {
      registry,
      sleeps,
      log: (line) => process.stderr.write(line),
    });
    if (url === null) {
      throw new Error(
        `npm: ${name}@${version} was published but its per-version document never resolved; not publishing the main package, which would install without it`,
      );
    }
  }
}
