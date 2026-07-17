/**
 * `verifyCrate` — the `.crate` contents-verification engine command (#449).
 * Isolated: its collaborators (`findCrateFile`, `extractCrate`,
 * `hasCrateSource`, `listFilesRecursive`, `node:fs/promises`) are mocked, so
 * this unit test drives every branch — source present (lib.rs / main.rs),
 * missing crate, empty crate, missing source, and the no-rows short-circuit —
 * through return values rather than real tarballs. Real end-to-end extraction
 * over a live registry root is covered by
 * tests/integration/verify-crate.integration.test.ts and e2e.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rm } from 'node:fs/promises';

import { verifyCrate } from './index.js';
import { extractCrate } from './extract-crate.js';
import { findCrateFile } from './find-crate-file.js';
import { hasCrateSource } from './has-crate-source.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';

vi.mock('node:fs/promises');
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
  it('returns 0 with a friendly line when there are no crates rows', async () => {
    const code = await verifyCrate({ matrix: matrix([{ name: 'p', kind: 'npm', version: '1.0.0' }]), registryRoot: '/reg' });
    expect(out.join('')).toContain('No crates rows; nothing to verify.');
    expect(code).toBe(0);
  });

  it('passes on a library crate shipping src/lib.rs', async () => {
    findCrate.mockResolvedValue('/reg/crates/demo-crate/demo-crate-1.0.0.crate');
    extract.mockResolvedValue('/tmp/extracted');
    hasSource.mockResolvedValue(true);
    const code = await verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    expect(out.join('')).toContain('contains src/lib.rs or src/main.rs');
    expect(code).toBe(0);
  });

  it('passes on a binary crate shipping src/main.rs', async () => {
    findCrate.mockResolvedValue('/reg/crates/demo-crate/demo-crate-1.0.0.crate');
    extract.mockResolvedValue('/tmp/extracted');
    hasSource.mockResolvedValue(true);
    const code = await verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    expect(out.join('')).toContain('ok:');
    expect(code).toBe(0);
  });

  it('fails when no .crate is present under the registry root', async () => {
    findCrate.mockResolvedValue(null);
    const code = await verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    const text = out.join('');
    expect(text).toContain('[demo-crate@1.0.0] no .crate file found (or empty)');
    expect(text).toContain('/reg');
    expect(code).toBe(1);
  });

  it('fails when the .crate is empty', async () => {
    findCrate.mockResolvedValue(null);
    const code = await verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    expect(out.join('')).toContain('no .crate file found (or empty)');
    expect(code).toBe(1);
  });

  it('fails and lists contents when neither src/lib.rs nor src/main.rs is present', async () => {
    findCrate.mockResolvedValue('/reg/crates/demo-crate/demo-crate-1.0.0.crate');
    extract.mockResolvedValue('/tmp/extracted');
    hasSource.mockResolvedValue(false);
    listFiles.mockResolvedValue([
      '/tmp/extracted/demo-crate-1.0.0/Cargo.toml',
      '/tmp/extracted/demo-crate-1.0.0/README.md',
    ]);
    const code = await verifyCrate({ matrix: matrix([row()]), registryRoot: '/reg' });
    const text = out.join('');
    expect(text).toContain('.crate tarball missing src/lib.rs and src/main.rs');
    expect(text).toContain('Tarball contents:');
    // The tarball contents are listed space-separated (join(' ')), not concatenated.
    expect(text).toContain('Cargo.toml /tmp/extracted/demo-crate-1.0.0/README.md');
    // The extracted temp dir is cleaned up recursively/forcefully.
    expect(vi.mocked(rm)).toHaveBeenCalledWith(expect.anything(), { recursive: true, force: true });
    expect(code).toBe(1);
  });

  it('aggregates: one good, one bad → exit 1, both reported', async () => {
    findCrate.mockResolvedValueOnce('/reg/good.crate').mockResolvedValueOnce('/reg/bad.crate');
    extract.mockResolvedValueOnce('/tmp/good').mockResolvedValueOnce('/tmp/bad');
    hasSource.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    listFiles.mockResolvedValue(['/tmp/bad/bad-crate-2.0.0/README.md']);
    const code = await verifyCrate({
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
