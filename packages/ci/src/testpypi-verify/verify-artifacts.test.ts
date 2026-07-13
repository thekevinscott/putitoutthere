/**
 * Composition-root wiring test for the metadata-verification phase. Mocks the
 * subprocess boundary (`node:child_process`), `node:fs`, and every decision
 * collaborator, isolating the per-requirement flow: wheel selection → `unzip`
 * listing/read → METADATA version check → `ok:`; then sdist selection → `tar`
 * listing/read → PKG-INFO version check → `ok:`; plus each failure branch.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metadataVersion } from './metadata-version.js';
import { parseRequirement } from './parse-requirement.js';
import { selectDownloadedSdist } from './select-downloaded-sdist.js';
import { selectDownloadedWheel } from './select-downloaded-wheel.js';
import { selectMetadataMember } from './select-metadata-member.js';
import { selectPkgInfoMember } from './select-pkginfo-member.js';
import { verifyArtifacts } from './verify-artifacts.js';
import { versionMatch } from './version-match.js';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('./metadata-version.js');
vi.mock('./parse-requirement.js');
vi.mock('./select-downloaded-sdist.js');
vi.mock('./select-downloaded-wheel.js');
vi.mock('./select-metadata-member.js');
vi.mock('./select-pkginfo-member.js');
vi.mock('./version-match.js');

const exec = vi.mocked(execFileSync);
const readdir = vi.mocked(readdirSync);
const out: string[] = [];
const err: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  err.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  readdir.mockImplementation(
    ((dir: string) =>
      (dir === 'downloaded-wheels' ? ['w.whl'] : ['s.tar.gz'])) as unknown as typeof readdirSync,
  );
  vi.mocked(parseRequirement).mockReturnValue({ package: 'pkg', version: '1.0', stem: 'pkg' });
  vi.mocked(selectDownloadedWheel).mockReturnValue('pkg-1.0-py3.whl');
  vi.mocked(selectDownloadedSdist).mockReturnValue('pkg-1.0.tar.gz');
  vi.mocked(selectMetadataMember).mockReturnValue({ member: 'pkg-1.0.dist-info/METADATA' });
  vi.mocked(selectPkgInfoMember).mockReturnValue({ member: 'pkg-1.0/PKG-INFO' });
  vi.mocked(metadataVersion).mockReturnValue('1.0');
  vi.mocked(versionMatch).mockImplementation(({ name, label }) => ({ okLine: `ok: ${name} ${label} v` }));
  exec.mockImplementation((cmd: string, args?: readonly string[]) => {
    if (cmd === 'unzip' && args?.[0] === '-Z1') {
      return 'pkg-1.0.dist-info/METADATA\npkg-1.0.dist-info/RECORD\n';
    }
    if (cmd === 'unzip' && args?.[0] === '-p') {
      return 'META_TEXT';
    }
    if (cmd === 'tar' && args?.[0] === '-tzf') {
      return 'pkg-1.0/PKG-INFO\npkg-1.0/setup.py\n';
    }
    return 'PKG_TEXT';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyArtifacts', () => {
  it('verifies the wheel then the sdist and prints both ok lines', () => {
    expect(verifyArtifacts(['pkg==1.0'])).toBe(0);

    expect(readdir).toHaveBeenCalledWith('downloaded-wheels');
    expect(readdir).toHaveBeenCalledWith('downloaded-sdists');
    expect(parseRequirement).toHaveBeenCalledWith('pkg==1.0');

    expect(selectDownloadedWheel).toHaveBeenCalledWith(['w.whl'], 'pkg', '1.0');
    expect(exec).toHaveBeenCalledWith('unzip', ['-Z1', 'downloaded-wheels/pkg-1.0-py3.whl'], { encoding: 'utf8' });
    expect(selectMetadataMember).toHaveBeenCalledWith(
      ['pkg-1.0.dist-info/METADATA', 'pkg-1.0.dist-info/RECORD'],
      'pkg-1.0-py3.whl',
    );
    expect(exec).toHaveBeenCalledWith(
      'unzip',
      ['-p', 'downloaded-wheels/pkg-1.0-py3.whl', 'pkg-1.0.dist-info/METADATA'],
      { encoding: 'utf8' },
    );
    expect(metadataVersion).toHaveBeenCalledWith('META_TEXT');
    expect(versionMatch).toHaveBeenCalledWith({
      name: 'pkg-1.0-py3.whl',
      label: 'METADATA',
      actual: '1.0',
      expected: '1.0',
    });

    expect(selectDownloadedSdist).toHaveBeenCalledWith(['s.tar.gz'], 'pkg', '1.0');
    expect(exec).toHaveBeenCalledWith('tar', ['-tzf', 'downloaded-sdists/pkg-1.0.tar.gz'], { encoding: 'utf8' });
    expect(selectPkgInfoMember).toHaveBeenCalledWith(['pkg-1.0/PKG-INFO', 'pkg-1.0/setup.py'], 'pkg-1.0.tar.gz');
    expect(exec).toHaveBeenCalledWith(
      'tar',
      ['-xzOf', 'downloaded-sdists/pkg-1.0.tar.gz', 'pkg-1.0/PKG-INFO'],
      { encoding: 'utf8' },
    );
    expect(metadataVersion).toHaveBeenCalledWith('PKG_TEXT');
    expect(versionMatch).toHaveBeenCalledWith({
      name: 'pkg-1.0.tar.gz',
      label: 'PKG-INFO',
      actual: '1.0',
      expected: '1.0',
    });

    expect(out.join('')).toBe('ok: pkg-1.0-py3.whl METADATA v\nok: pkg-1.0.tar.gz PKG-INFO v\n');
  });

  it('fails when no wheel was downloaded', () => {
    vi.mocked(selectDownloadedWheel).mockReturnValue(null);
    expect(verifyArtifacts(['pkg==1.0'])).toBe(1);
    expect(err.join('')).toBe('no downloaded wheel for pkg==1.0\n');
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails on the METADATA selection error', () => {
    vi.mocked(selectMetadataMember).mockReturnValue({ errorLine: 'expected one METADATA file in pkg-1.0-py3.whl, found []' });
    expect(verifyArtifacts(['pkg==1.0'])).toBe(1);
    expect(err.join('')).toBe('expected one METADATA file in pkg-1.0-py3.whl, found []\n');
    expect(selectDownloadedSdist).not.toHaveBeenCalled();
  });

  it('fails on a wheel version mismatch before touching the sdist', () => {
    vi.mocked(versionMatch).mockImplementation(({ label }) =>
      label === 'METADATA' ? { errorLine: 'wheel mismatch' } : { okLine: 'unused' },
    );
    expect(verifyArtifacts(['pkg==1.0'])).toBe(1);
    expect(err.join('')).toBe('wheel mismatch\n');
    expect(selectDownloadedSdist).not.toHaveBeenCalled();
  });

  it('fails when no sdist was downloaded', () => {
    vi.mocked(selectDownloadedSdist).mockReturnValue(null);
    expect(verifyArtifacts(['pkg==1.0'])).toBe(1);
    expect(err.join('')).toBe('no downloaded sdist for pkg==1.0\n');
  });

  it('fails on the PKG-INFO selection error', () => {
    vi.mocked(selectPkgInfoMember).mockReturnValue({ errorLine: 'no PKG-INFO file in pkg-1.0.tar.gz' });
    expect(verifyArtifacts(['pkg==1.0'])).toBe(1);
    expect(err.join('')).toBe('no PKG-INFO file in pkg-1.0.tar.gz\n');
  });

  it('fails on an sdist version mismatch', () => {
    vi.mocked(versionMatch).mockImplementation(({ label }) =>
      label === 'PKG-INFO' ? { errorLine: 'sdist mismatch' } : { okLine: 'ok: wheel' },
    );
    expect(verifyArtifacts(['pkg==1.0'])).toBe(1);
    expect(err.join('')).toBe('sdist mismatch\n');
  });
});
