import { dirname, join } from 'node:path';

import { pathExists } from '../utils/path-exists.js';
import type { Installer } from './types.js';

/**
 * A workspace member keeps no lockfile of its own, so walk up to `boundary`
 * (#721). The nearest directory with a marker decides.
 */
export async function findInstaller(dir: string, boundary: string): Promise<Installer> {
  for (let current = dir; ; current = dirname(current)) {
    if (await pathExists(join(current, 'package-lock.json'))) {return 'npm';}
    if (await pathExists(join(current, 'pnpm-lock.yaml'))) {return 'pnpm';}
    if (await pathExists(join(current, 'pnpm-workspace.yaml'))) {return 'pnpm';}
    if (current === boundary || dirname(current) === current) {return 'none';}
  }
}
