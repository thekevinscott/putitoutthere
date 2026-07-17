/**
 * Composition root for `testpypi-verify metadata` — the "Verify TestPyPI
 * artifact metadata" step. Wires the phases the bash ran in order: build the
 * pinned requirements from `dist/`, write `testpypi-requirements.txt`, reset
 * the download directories, download the wheels, download the sdists, and
 * verify each artifact's metadata version. The only I/O here is the env read,
 * the `dist/` listing, and the requirements-file/directory bookkeeping; every
 * decision and each network phase lives in its own module.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';

import { buildRequirements } from './build-requirements.js';
import { downloadSdists } from './download-sdists.js';
import { downloadWheels } from './download-wheels.js';
import { verifyArtifacts } from './verify-artifacts.js';

const DIST_DIR = 'dist';
const REQUIREMENTS_FILE = 'testpypi-requirements.txt';
const WHEELS_DIR = 'downloaded-wheels';
const SDISTS_DIR = 'downloaded-sdists';

export async function runTestpypiMetadata(): Promise<number> {
  const indexUrl = process.env.TESTPYPI_INDEX_URL;
  if (indexUrl === undefined || indexUrl === '') {
    process.stdout.write('::error::testpypi-verify: TESTPYPI_INDEX_URL must be set.\n');
    return 1;
  }

  const distFiles = (await readdir(DIST_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const built = buildRequirements(distFiles);
  if ('errorLine' in built) {
    process.stderr.write(`${built.errorLine}\n`);
    return 1;
  }
  const { requirements } = built;
  await writeFile(REQUIREMENTS_FILE, requirements.map((requirement) => `${requirement}\n`).join(''));

  await rm(WHEELS_DIR, { recursive: true, force: true });
  await rm(SDISTS_DIR, { recursive: true, force: true });
  await mkdir(WHEELS_DIR, { recursive: true });
  await mkdir(SDISTS_DIR, { recursive: true });

  const wheelExit = await downloadWheels(requirements, indexUrl);
  if (wheelExit !== 0) {
    return wheelExit;
  }
  const sdistExit = await downloadSdists(requirements, indexUrl);
  if (sdistExit !== 0) {
    return sdistExit;
  }
  return verifyArtifacts(requirements);
}
