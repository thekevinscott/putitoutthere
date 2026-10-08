import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

const startDir = process.cwd();
let out: string;

function dist(...names: string[]): void {
  const root = mkdtempSync(join(tmpdir(), 'piot-discard-first-publish-'));
  mkdirSync(join(root, 'dist/nested_placeholder'), { recursive: true });
  for (const name of names) {writeFileSync(join(root, 'dist', name), '');}
  process.chdir(root);
}

const discard = (): Promise<number> => run(['node', 'piot-ci', 'discard-first-publish-dists']);

beforeEach(() => {
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
});

afterEach(() => {
  process.chdir(startDir);
  vi.restoreAllMocks();
});

it('removes every first-publish artifact from dist/ and warns with the count', async () => {
  dist(
    'piot_fixture_zzz_py_placeholder-0.1.0.tar.gz',
    'piot_fixture_zzz_py_placeholder-0.1.0-cp312-abi3-manylinux_2_17_x86_64.whl',
    'piot-fixture-zzz-maturin-placeholder-0.1.0.tar.gz',
    'piot_fixture_zzz_hatch-1.2.3-py3-none-any.whl',
    'piot_fixture_zzz_hatch-1.2.3.tar.gz',
  );
  await expect(discard()).resolves.toBe(0);
  expect(readdirSync('dist').sort()).toEqual([
    'nested_placeholder',
    'piot_fixture_zzz_hatch-1.2.3-py3-none-any.whl',
    'piot_fixture_zzz_hatch-1.2.3.tar.gz',
  ]);
  expect(out).toContain('  dropped: piot_fixture_zzz_py_placeholder-0.1.0.tar.gz\n');
  expect(out).toContain('  dropped: piot-fixture-zzz-maturin-placeholder-0.1.0.tar.gz\n');
  expect(out).toContain(
    '::warning::Dropped 3 first-publish artifact(s) from dist/ — Trusted Publisher records are not provisioned for uniquified package names. The maturin build path on a first-publish fixture is guarded by the in-job wheel-content guard, not by the real-PyPI upload.\n',
  );
});

it('leaves dist/ alone and prints nothing when no artifact is a first-publish one', async () => {
  dist('piot_fixture_zzz_hatch-1.2.3.tar.gz', 'placeholder-notes.txt');
  await expect(discard()).resolves.toBe(0);
  expect(readdirSync('dist').sort()).toEqual(['nested_placeholder', 'piot_fixture_zzz_hatch-1.2.3.tar.gz', 'placeholder-notes.txt']);
  expect(out).toBe('');
});
