import { stat } from 'node:fs/promises';

import type { Package } from '../config.js';
import { pathExists } from '../utils/path-exists.js';
import type { CheckFinding } from './check-types.js';

export async function checkPaths(packages: readonly Package[], findings: CheckFinding[]): Promise<void> {
  for (const p of packages) {
    if (!(await pathExists(p.path)) || !(await stat(p.path)).isDirectory()) {
      findings.push({
        package: p.name,
        message: `path "${p.path}" does not exist or is not a directory in the worktree`,
      });
    }
  }
}
