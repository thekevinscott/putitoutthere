import { chmod, cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Ctx } from '../types.js';
import {
  pickMainFile,
  platformArtifactName,
  targetToOsCpu,
  type NpmBuildEntry,
  type PlatformPkg,
} from './npm-platform.js';

export async function synthesizePlatformPackage(
  pkg: PlatformPkg,
  entry: NpmBuildEntry,
  target: string,
  platformName: string,
  version: string,
  ctx: Ctx,
  isMulti: boolean,
): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'putitoutthere-plat-'));

  // #237: encode pkg.name to match the on-disk artifact directory the
  // planner emitted (slash-containing names like `js/foo` land at
  // `artifacts/js__foo-<triple>/`, not `artifacts/js/foo-<triple>/`).
  const artifactName = platformArtifactName(pkg.name, entry.mode, target, isMulti);
  const artifactsRoot = ctx.artifactsRoot ?? join(ctx.cwd, 'artifacts');
  const artifactDir = join(artifactsRoot, artifactName);

  const files = await readdir(artifactDir);
  if (files.length === 0) {
    throw new Error(`platform artifact empty: ${artifactDir}`);
  }
  for (const f of files) {
    await cp(join(artifactDir, f), join(staging, f), { recursive: true });
  }

  const { os, cpu, libc } = targetToOsCpu(target);
  const fileList = await readdir(staging);
  const mainFile = await pickMainFile(staging, fileList, entry.mode);

  // #365: bundled-cli binaries ship as package data referenced via
  // `main`, not as a `bin` entry, so npm never sets the executable bit —
  // and it is stripped crossing the Actions artifact upload/download
  // boundary regardless of the mode `cargo build` produced. Restore +x
  // on the staged binary for non-Windows targets; without it the
  // launcher's spawn of the resolved binary EACCESes at runtime.
  // #626: this chmods exactly what `main` names, which is why
  // `pickMainFile` must resolve to a file — when it returned the `bin`
  // directory of a nested artifact, the +x landed on the directory and
  // the tarball shipped the binary at 0644.
  if (entry.mode === 'bundled-cli' && !os.includes('win32')) {
    await chmod(join(staging, mainFile), 0o755);
  }

  // npm provenance verifier compares package.json.repository.url against
  // the publishing GitHub repo URL baked into the sigstore bundle. A
  // synthesized platform package without `repository` fails with E422
  // "repository.url is \"\"". Inherit repository/license/homepage from
  // the main package so per-platform tarballs validate.
  const mainPkgRaw = await readFile(join(pkg.path, 'package.json'), 'utf8');
  const mainPkg = JSON.parse(mainPkgRaw) as Record<string, unknown>;

  const platformJson: Record<string, unknown> = {
    name: platformName,
    version,
    os,
    cpu,
    files: fileList,
    main: mainFile,
    libc,
    repository: mainPkg['repository'],
    license: mainPkg['license'],
    homepage: mainPkg['homepage'],
  };
  await writeFile(
    join(staging, 'package.json'),
    JSON.stringify(platformJson, null, 2) + '\n',
    'utf8',
  );

  return staging;
}
