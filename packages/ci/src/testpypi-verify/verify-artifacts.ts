/**
 * Composition root for the metadata-verification phase of `testpypi-verify
 * metadata`. Reproduces the bash heredoc that, per requirement, opened the
 * downloaded wheel and sdist, read the single `METADATA` / `PKG-INFO` member,
 * and asserted its `Version:` matched the requirement — printing `ok: …` on
 * success and failing with the exact stderr line on the first mismatch. The
 * archive member listing/extraction runs through `unzip`/`tar` (the same
 * subprocess boundary the harness uses); the selection and version-match
 * decisions are the pure cores'. Returns the exit code (0 = all verified).
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { metadataVersion } from './metadata-version.js';
import { parseRequirement } from './parse-requirement.js';
import { selectDownloadedSdist } from './select-downloaded-sdist.js';
import { selectDownloadedWheel } from './select-downloaded-wheel.js';
import { selectMetadataMember } from './select-metadata-member.js';
import { selectPkgInfoMember } from './select-pkginfo-member.js';
import { versionMatch } from './version-match.js';

const WHEELS_DIR = 'downloaded-wheels';
const SDISTS_DIR = 'downloaded-sdists';

function listEntries(output: string): string[] {
  return output.split('\n').filter((name) => name.length > 0);
}

export function verifyArtifacts(requirements: readonly string[]): number {
  const wheelFiles = readdirSync(WHEELS_DIR);
  const sdistFiles = readdirSync(SDISTS_DIR);
  for (const requirement of requirements) {
    const { version, stem } = parseRequirement(requirement);

    const wheelName = selectDownloadedWheel(wheelFiles, stem, version);
    if (wheelName === null) {
      process.stderr.write(`no downloaded wheel for ${requirement}\n`);
      return 1;
    }
    const wheelPath = `${WHEELS_DIR}/${wheelName}`;
    const metaSelection = selectMetadataMember(
      listEntries(execFileSync('unzip', ['-Z1', wheelPath], { encoding: 'utf8' })),
      wheelName,
    );
    if ('errorLine' in metaSelection) {
      process.stderr.write(`${metaSelection.errorLine}\n`);
      return 1;
    }
    const metadataText = execFileSync('unzip', ['-p', wheelPath, metaSelection.member], { encoding: 'utf8' });
    const wheelResult = versionMatch({
      name: wheelName,
      label: 'METADATA',
      actual: metadataVersion(metadataText),
      expected: version,
    });
    if ('errorLine' in wheelResult) {
      process.stderr.write(`${wheelResult.errorLine}\n`);
      return 1;
    }
    process.stdout.write(`${wheelResult.okLine}\n`);

    const sdistName = selectDownloadedSdist(sdistFiles, stem, version);
    if (sdistName === null) {
      process.stderr.write(`no downloaded sdist for ${requirement}\n`);
      return 1;
    }
    const sdistPath = `${SDISTS_DIR}/${sdistName}`;
    const pkgSelection = selectPkgInfoMember(
      listEntries(execFileSync('tar', ['-tzf', sdistPath], { encoding: 'utf8' })),
      sdistName,
    );
    if ('errorLine' in pkgSelection) {
      process.stderr.write(`${pkgSelection.errorLine}\n`);
      return 1;
    }
    const pkgInfoText = execFileSync('tar', ['-xzOf', sdistPath, pkgSelection.member], { encoding: 'utf8' });
    const sdistResult = versionMatch({
      name: sdistName,
      label: 'PKG-INFO',
      actual: metadataVersion(pkgInfoText),
      expected: version,
    });
    if ('errorLine' in sdistResult) {
      process.stderr.write(`${sdistResult.errorLine}\n`);
      return 1;
    }
    process.stdout.write(`${sdistResult.okLine}\n`);
  }
  return 0;
}
