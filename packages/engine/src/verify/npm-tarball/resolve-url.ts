/**
 * Resolve a published package's tarball URL via `npm view … dist.tarball`,
 * absorbing packument lag with a bounded retry (#443): the packument index
 * propagates across the registry CDN asynchronously, so an immediate read after
 * publish can come back empty. N `sleeps` means N+1 attempts; `null` if all
 * empty. `--registry` goes after the positional args, clear of `name@version`.
 */

import { execCapture } from '../../utils/exec-capture.js';

interface ResolveOptions {
  registry?: string | undefined;
  sleeps: number[];
}

async function viewTarballUrl(spec: string, registry?: string): Promise<string> {
  try {
    const args = ['view', spec, 'dist.tarball', ...(registry ? ['--registry', registry] : [])];
    return (await execCapture('npm', args)).stdout.trim();
  } catch {
    // `npm view` exits non-zero when the packument isn't there yet.
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveNpmTarballUrl(
  name: string,
  version: string,
  opts: ResolveOptions,
): Promise<string | null> {
  const spec = `${name}@${version}`;
  const attempts = opts.sleeps.length + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const url = await viewTarballUrl(spec, opts.registry);
    if (url) {return url;}
    if (attempt < attempts) {
      const secs = opts.sleeps[attempt - 1]!;
      process.stdout.write(
        `  packument lag: npm view returned empty (attempt ${attempt}/${attempts}); retrying in ${secs}s\n`,
      );
      await sleep(secs * 1000);
    }
  }
  return null;
}
