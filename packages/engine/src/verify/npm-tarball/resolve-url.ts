import { sleep } from '../../utils/sleep.js';

interface ResolveOptions {
  registry?: string | undefined;
  sleeps: number[];
  deadline?: number | undefined;
  log?: (line: string) => void;
}

export async function resolveNpmTarballUrl(
  name: string,
  version: string,
  opts: ResolveOptions,
): Promise<string | null> {
  const base = (opts.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '');
  const url = `${base}/${encodeURIComponent(name).replace('%40', '@')}/${version}`;
  const { deadline } = opts;
  const of = deadline === undefined ? `/${opts.sleeps.length + 1}` : '';
  for (let attempt = 1; ; attempt++) {
    const tarball = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      .then(async (res) => (res.ok ? ((await res.json()) as { dist: { tarball?: string } }).dist.tarball : undefined))
      .catch(() => undefined);
    if (tarball) {return tarball;}
    const scheduled = opts.sleeps[attempt - 1] ?? (deadline === undefined ? undefined : opts.sleeps.at(-1));
    if (scheduled === undefined) {return null;}
    const waitMs = deadline === undefined ? scheduled * 1000 : Math.min(scheduled * 1000, deadline - Date.now());
    if (waitMs <= 0) {return null;}
    (opts.log ?? ((l: string) => process.stdout.write(l)))(`  ${url} not readable yet (attempt ${attempt}${of}); retrying in ${Math.ceil(waitMs / 1000)}s\n`);
    await sleep(waitMs);
  }
}
