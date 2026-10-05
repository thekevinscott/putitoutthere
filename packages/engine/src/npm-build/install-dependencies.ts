import { runTool } from './run-tool.js';
import type { Installer } from './types.js';

// First publish of a napi/bundled-cli family: its platform optionalDependencies
// 404, the lockfile drops them, and the strict install refuses (#256).
const DRIFT = 'likely 404 on platform-package optionalDependencies for a brand-new bundled-cli/napi family';

const STRICT = {
  npm: {
    tool: 'npm',
    strict: ['ci'],
    lenient: ['install'],
    warning: `package-lock.json drift (${DRIFT}); falling back to npm install`,
  },
  pnpm: {
    tool: 'pnpm',
    strict: ['install', '--frozen-lockfile'],
    lenient: ['install', '--no-frozen-lockfile'],
    warning: `pnpm-lock.yaml drift (${DRIFT}); falling back to pnpm install --no-frozen-lockfile`,
  },
} as const;

export async function installDependencies(dir: string, installer: Installer): Promise<void> {
  if (installer === 'none') {
    await runTool('npm', ['install'], { cwd: dir });
    return;
  }
  if (installer === 'pnpm') {
    // The consumer's pnpm, not this repo's toolchain.
    await runTool('npm', ['install', '-g', 'pnpm@11'], { cwd: dir });
  }
  const plan = STRICT[installer];
  try {
    await runTool(plan.tool, plan.strict, { cwd: dir });
  } catch {
    process.stdout.write(`::warning::${plan.warning}\n`);
    await runTool(plan.tool, plan.lenient, { cwd: dir });
  }
}
