import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { checkGnuLinkage } from './check-gnu-linkage.js';

export interface BundleCliVerifyOptions {
  dir: string;
  shownDir: string;
  bin: string;
  target: string;
}

export async function bundleCliVerify(opts: BundleCliVerifyOptions): Promise<boolean> {
  const name = process.platform === 'win32' ? `${opts.bin}.exe` : opts.bin;
  const binary = join(opts.dir, name);
  const shown = `${opts.shownDir}/${name}`;
  try {
    await access(binary);
  } catch {
    const listing = await readdir(opts.dir).catch(() => []);
    process.stdout.write(`::error::bundle_cli staged binary missing at ${shown}\n${listing.map((entry) => `${entry}\n`).join('')}`);
    return false;
  }
  process.stdout.write(`ok bundle_cli: ${shown} present\n`);
  if (process.platform !== 'linux') {return true;}
  if (opts.target.includes('-linux-musl')) {
    process.stdout.write(
      `ok bundle_cli: ${shown} targets musl — static linkage is expected here; the dlopen / glibc-ceiling checks are gnu-lane only\n`,
    );
    return true;
  }
  return checkGnuLinkage(binary, shown);
}
