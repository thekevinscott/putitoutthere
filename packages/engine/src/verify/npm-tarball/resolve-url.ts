import { sleep } from '../../utils/sleep.js';

interface ResolveOptions {
  registry?: string | undefined;
  sleeps: number[];
}

export async function resolveNpmTarballUrl(
  name: string,
  version: string,
  opts: ResolveOptions,
): Promise<string | null> {
  const base = (opts.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '');
  const url = `${base}/${encodeURIComponent(name).replace('%40', '@')}/${version}`;
  const attempts = opts.sleeps.length + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const tarball = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      .then(async (res) => (res.ok ? ((await res.json()) as { dist?: { tarball?: string } }).dist?.tarball : undefined))
      .catch(() => undefined);
    if (tarball) {return tarball;}
    if (attempt < attempts) {
      const secs = opts.sleeps[attempt - 1]!;
      process.stdout.write(`  ${url} not readable yet (attempt ${attempt}/${attempts}); retrying in ${secs}s\n`);
      await sleep(secs * 1000);
    }
  }
  return null;
}
