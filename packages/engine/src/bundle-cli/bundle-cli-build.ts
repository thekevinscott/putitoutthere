import { execInherit } from '../utils/exec-inherit.js';

export interface BundleCliBuildOptions {
  target: string;
  bin: string;
  features: string;
  noDefaultFeatures: boolean;
}

export async function bundleCliBuild(crateDir: string, opts: BundleCliBuildOptions): Promise<void> {
  const linux = opts.target.includes('-linux-gnu') || opts.target.includes('-linux-musl');
  const target = opts.target.includes('-linux-gnu') ? `${opts.target}.2.17` : opts.target;
  const args = [linux ? 'zigbuild' : 'build', '--release', '--target', target, '--bin', opts.bin, '--target-dir', 'target'];
  if (opts.features !== '') {args.push('--features', opts.features);}
  if (opts.noDefaultFeatures) {args.push('--no-default-features');}
  await execInherit('cargo', args, { cwd: crateDir });
}
