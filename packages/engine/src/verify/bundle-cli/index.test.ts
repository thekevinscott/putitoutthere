/**
 * `verifyBundleCli` — the bundled-CLI wheel-contents engine command (#451).
 * Unit-isolated: the wheel lookup (`findDistFile`), the zip reader
 * (`readZipEntry`), the pyproject read (`readPythonSource`) and `node:fs`
 * are all mocked, so each case drives one branch — binary present, absolute
 * vs relative `--path`, Windows `.exe`, python-source stripping, missing
 * binary (+ the `wheel contents:` listing), and the no-wheel short-circuit —
 * without touching disk. Real deflate-`.whl` IO is covered by the verify
 * integration/e2e tiers. `computeStageSuffix` is left real: it is a pure
 * string transform this command composes, so the python-source subtraction
 * is exercised for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyBundleCli } from './index.js';
import { findDistFile } from '../wheel/find-dist-file.js';
import { readZipEntry } from '../wheel/read-zip-entry.js';
import { readPythonSource } from './read-python-source.js';

vi.mock('node:fs');
vi.mock('../wheel/find-dist-file.js');
vi.mock('../wheel/read-zip-entry.js');
vi.mock('./read-python-source.js');

const findDistFileMock = vi.mocked(findDistFile);
const readZipEntryMock = vi.mocked(readZipEntry);
const readPythonSourceMock = vi.mocked(readPythonSource);

const out: string[] = [];

/** The wheel's entry names the (real) matcher callback walks. */
let entryNames: string[] = [];

const WHEEL = '/pkg/dist/demo-1.0.0-cp312-cp312-linux_x86_64.whl';

beforeEach(() => {
  out.length = 0;
  entryNames = [];
  readPythonSourceMock.mockReturnValue('');
  findDistFileMock.mockReturnValue(WHEEL);
  // Run the unit's own matcher callback over `entryNames`, returning a
  // non-null buffer for the first hit (mirrors readZipEntry's contract) so
  // the endsWith match + the miss-path entry collection are genuinely tested.
  readZipEntryMock.mockImplementation((_buf, matches: (name: string) => boolean) => {
    for (const name of entryNames) {
      if (matches(name)) {
        return Buffer.from(name);
      }
    }
    return null;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const opts = (over: Partial<{ cwd: string; path: string; stageTo: string; bin: string; target: string }> = {}) => ({
  cwd: '/unused', path: '/pkg', stageTo: 'dirsql/_binary', bin: 'dirsql', target: 'x86_64-unknown-linux-gnu', ...over,
});

describe('verifyBundleCli', () => {
  it('passes when the wheel contains <stage_to>/<bin> (absolute path)', () => {
    entryNames = ['demo/__init__.py', 'dirsql/_binary/dirsql'];
    const code = verifyBundleCli(opts());
    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in demo-1.0.0-cp312-cp312-linux_x86_64.whl');
    expect(code).toBe(0);
  });

  it('resolves a relative --path against cwd', () => {
    // Relative path is resolved against cwd before the dist lookup: the
    // dist dir handed to findDistFile is `<cwd>/<path>/dist`. Assert it with
    // a separator-agnostic pattern so Windows backslashes don't break it.
    entryNames = ['stage/bin/tool'];
    const code = verifyBundleCli(opts({ cwd: '/work', path: 'pkg', stageTo: 'stage/bin', bin: 'tool' }));
    expect(findDistFileMock).toHaveBeenCalledWith(expect.stringMatching(/work[/\\]pkg[/\\]dist$/), '.whl');
    expect(out.join('')).toContain('ok bundle_cli: stage/bin/tool present in');
    expect(code).toBe(0);
  });

  it('appends .exe on a Windows target', () => {
    entryNames = ['stage/bin/tool.exe'];
    const code = verifyBundleCli(opts({ stageTo: 'stage/bin', bin: 'tool', target: 'x86_64-pc-windows-msvc' }));
    expect(out.join('')).toContain('ok bundle_cli: stage/bin/tool.exe present in');
    expect(code).toBe(0);
  });

  it('subtracts [tool.maturin].python-source before matching', () => {
    readPythonSourceMock.mockReturnValue('python');
    entryNames = ['dirsql/_binary/dirsql'];
    const code = verifyBundleCli(opts({ stageTo: 'python/dirsql/_binary' }));
    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('fails and lists contents when the binary is missing', () => {
    entryNames = ['demo/__init__.py', 'demo-1.0.0.dist-info/METADATA'];
    const code = verifyBundleCli(opts());
    const text = out.join('');
    expect(text).toContain('::error::wheel demo-1.0.0-cp312-cp312-linux_x86_64.whl missing bundle_cli binary at dirsql/_binary/dirsql');
    expect(text).toContain('wheel contents:');
    expect(text).toContain('demo/__init__.py');
    expect(text).toContain('demo-1.0.0.dist-info/METADATA');
    expect(code).toBe(1);
  });

  it('fails when no wheel is produced under dist/', () => {
    findDistFileMock.mockReturnValue(null);
    const code = verifyBundleCli(opts());
    expect(out.join('')).toContain('::error::no wheel produced under');
    expect(code).toBe(1);
  });
});
