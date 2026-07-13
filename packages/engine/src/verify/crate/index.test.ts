/**
 * `verifyCrate` — the `.crate` contents-verification engine command (#449).
 * Isolated: its collaborators (`findCrateFile`, `extractCrate`,
 * `hasCrateSource`, `listFilesRecursive`, `node:fs`) are mocked, so this unit
 * test drives every branch — source present (lib.rs / main.rs), missing
 * crate, empty crate, missing source, and the no-rows short-circuit — through
 * return values rather than real tarballs. Real end-to-end extraction over a
 * live registry root is covered by
 * test/integration/verify-crate.integration.test.ts and e2e.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyCrate } from './index.js';
import { extractCrate } from './extract-crate.js';
import { findCrateFile } from './find-crate-file.js';
import { hasCrateSource } from './has-crate-source.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';

vi.mock('node:fs');
vi.mock('./extract-crate.js');
vi.mock('./find-crate-file.js');
vi.mock('./has-crate-source.js');
vi.mock('../../utils/list-files-recursive.js');

const findCrate = vi.mocked(findCrateFile);
const extract = vi.mocked(extractCrate);
const hasSource = vi.mocked(hasCrateSource);
const listFiles = vi.mocked(listFilesRecursive);

const out: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const matrix = (rows: object[]): string => JSON.stringify(rows);
const row = (over: object = {}): object => ({ name: 'demo-crate', kind: 'crates', version: '1.0.0', ...over });

describe('verifyCrate', () => {
  it('returns 0 with a friendly line when there are no crates rows', () => {
    const code = verifyCrate({ matrix: matrix([{ name: 'p', kind: 'npm', version: '1.0.0' }]), registryRoot: '/reg' });
    expect(out.join('')).toContain('No crates rows; nothing to verify.');
    expect(code).toBe(0);
  });

  it('passes on a library crate shipping src/lib.rs', () => {
    findCrate.mockReturnValue('/reg/crates/demo-crate/demo-crate-1.0.0.crate');
    extract.mockReturnValue('/tmp/extracted');
    hasSource.mockReturnValue(true);
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    expect(out.join('')).toContain('contains src/lib.rs or src/main.rs');
    expect(code).toBe(0);
  });

  it('passes on a binary crate shipping src/main.rs', () => {
    findCrate.mockReturnValue('/reg/crates/demo-crate/demo-crate-1.0.0.crate');
    extract.mockReturnValue('/tmp/extracted');
    hasSource.mockReturnValue(true);
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    expect(out.join('')).toContain('ok:');
    expect(code).toBe(0);
  });

  it('fails when no .crate is present under the registry root', () => {
    findCrate.mockReturnValue(null);
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    const text = out.join('');
    expect(text).toContain('[demo-crate@1.0.0] no .crate file found (or empty)');
    expect(text).toContain('/reg');
    expect(code).toBe(1);
  });

  it('fails when the .crate is empty', () => {
    findCrate.mockReturnValue(null);
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    expect(out.join('')).toContain('no .crate file found (or empty)');
    expect(code).toBe(1);
  });

  it('fails and lists contents when neither src/lib.rs nor src/main.rs is present', () => {
    findCrate.mockReturnValue('/reg/crates/demo-crate/demo-crate-1.0.0.crate');
    extract.mockReturnValue('/tmp/extracted');
    hasSource.mockReturnValue(false);
    listFiles.mockReturnValue([
      '/tmp/extracted/demo-crate-1.0.0/Cargo.toml',
      '/tmp/extracted/demo-crate-1.0.0/README.md',
    ]);
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    const text = out.join('');
    expect(text).toContain('.crate tarball missing src/lib.rs and src/main.rs');
    expect(text).toContain('Tarball contents:');
    expect(code).toBe(1);
  });

  it('aggregates: one good, one bad → exit 1, both reported', () => {
    findCrate.mockReturnValueOnce('/reg/good.crate').mockReturnValueOnce('/reg/bad.crate');
    extract.mockReturnValueOnce('/tmp/good').mockReturnValueOnce('/tmp/bad');
    hasSource.mockReturnValueOnce(true).mockReturnValueOnce(false);
    listFiles.mockReturnValue(['/tmp/bad/bad-crate-2.0.0/README.md']);
    const code = verifyCrate({
      matrix: matrix([
        { name: 'good-crate', kind: 'crates', version: '1.0.0' },
        { name: 'bad-crate', kind: 'crates', version: '2.0.0' },
      ]),
      registryRoot: '/reg',
    });
    const text = out.join('');
    expect(text).toContain('ok:');
    expect(text).toContain('[bad-crate@2.0.0] .crate tarball missing');
    expect(code).toBe(1);
  });
});
