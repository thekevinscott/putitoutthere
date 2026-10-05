import { findInstaller } from './find-installer.js';
import { installDependencies } from './install-dependencies.js';
import { runTool } from './run-tool.js';
import type { NpmBuildPackageOptions } from './types.js';

export async function npmBuildPackage(opts: NpmBuildPackageOptions): Promise<void> {
  const installer = await findInstaller(opts.dir, opts.boundary);
  process.stdout.write(`npm-build: ${opts.dir}: installer ${installer}\n`);
  await installDependencies(opts.dir, installer);
  await runTool('npm', ['run', 'build', '--if-present'], {
    cwd: opts.dir,
    env: { ...process.env, TARGET: opts.target, BUILD: opts.build, VERSION: opts.version },
  });
}
