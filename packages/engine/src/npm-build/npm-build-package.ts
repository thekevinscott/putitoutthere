import { dirname, join } from 'node:path';

import { execInherit, type ExecInheritOptions } from '../utils/exec-inherit.js';
import { pathExists } from '../utils/path-exists.js';

const DRIFT = 'likely 404 on platform-package optionalDependencies for a brand-new bundled-cli/napi family';
const MARKERS = [['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['pnpm-workspace.yaml', 'pnpm']] as const;

export async function npmBuildPackage(dir: string, boundary: string, env: Record<string, string>): Promise<void> {
  const tool = (name: string, args: string[], opts: ExecInheritOptions = { cwd: dir }): Promise<void> =>
    process.platform === 'win32' ? execInherit('cmd.exe', ['/d', '/s', '/c', name, ...args], opts) : execInherit(name, args, opts);
  let installer: 'npm' | 'pnpm' | undefined;
  for (let current = dir; installer === undefined; current = dirname(current)) {
    for (const [file, found] of MARKERS) {
      if (installer === undefined && (await pathExists(join(current, file)))) {installer = found;}
    }
    if (current === boundary || dirname(current) === current) {break;}
  }
  if (installer === undefined) {
    await tool('npm', ['install']);
  } else {
    const name = installer;
    if (name === 'pnpm') {await tool('npm', ['install', '-g', 'pnpm@11']);}
    const [strict, lenient, lockfile] = name === 'npm'
      ? [['ci'], ['install'], 'package-lock.json']
      : [['install', '--frozen-lockfile'], ['install', '--no-frozen-lockfile'], 'pnpm-lock.yaml'];
    await tool(name, strict).catch(async () => {
      process.stdout.write(`::warning::${lockfile} drift (${DRIFT}); falling back to ${name} ${lenient.join(' ')}\n`);
      await tool(name, lenient);
    });
  }
  await tool('npm', ['run', 'build', '--if-present'], { cwd: dir, env: { ...process.env, ...env } });
}
