/**
 * `piot verify wheel` (epic #442, #450), extracted from the inline bash in
 * `e2e-fixture-job.yml` (#276): a wheel's `*.dist-info/METADATA` `Version:`
 * must equal the planned version and an sdist's filename must contain it.
 * Real deflate zips built here in pure Node — no network, no `unzip`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { zip } from './zip-wheel.js';

/* ----------------------------- fixtures ----------------------------- */

let pkg: string;
const out: string[] = [];

function distDir(): string {
  const d = join(pkg, 'dist');
  mkdirSync(d, { recursive: true });
  return d;
}

function writeWheel(name: string, version: string, metadataVersion = version): void {
  const whl = zip({
    [`${name}-${version}.dist-info/METADATA`]: `Metadata-Version: 2.1\nName: ${name}\nVersion: ${metadataVersion}\n`,
    [`${name}/__init__.py`]: '\n',
  });
  writeFileSync(join(distDir(), `${name}-${version}-cp312-cp312-linux_x86_64.whl`), whl);
}

function writeSdist(name: string, version: string): void {
  // The sdist check is filename-only, so the bytes are irrelevant.
  writeFileSync(join(distDir(), `${name}-${version}.tar.gz`), 'sdist-bytes');
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-wheel-'));
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(pkg, { recursive: true, force: true });
});

function verify(target: string, version: string): Promise<number> {
  return run(['node', 'piot', 'verify', 'wheel', '--path', pkg, '--version', version, '--target', target]);
}

describe('piot verify wheel: wheel METADATA version (#450)', () => {
  it('passes when the wheel METADATA Version matches the planned version', async () => {
    writeWheel('demo', '1.2.3');
    const code = await verify('x86_64-unknown-linux-gnu', '1.2.3');
    expect(out.join('')).toContain('ok wheel:');
    expect(out.join('')).toContain('METADATA Version=1.2.3');
    expect(code).toBe(0);
  });

  it('fails when the wheel METADATA Version diverges from the plan', async () => {
    // The load-bearing bug: the build produced a wheel carrying the wrong
    // version even though the plan said 1.2.3.
    writeWheel('demo', '1.2.3', '0.9.0');
    const code = await verify('x86_64-unknown-linux-gnu', '1.2.3');
    const text = out.join('');
    expect(text).toContain("wheel METADATA Version='0.9.0' but plan='1.2.3'");
    expect(code).toBe(1);
  });

  it('fails when no wheel was produced', async () => {
    distDir();
    const code = await verify('x86_64-unknown-linux-gnu', '1.2.3');
    expect(out.join('')).toContain('no wheel produced in');
    expect(code).toBe(1);
  });

  it('fails when no dist/ directory exists at all', async () => {
    const code = await verify('x86_64-unknown-linux-gnu', '1.2.3');
    expect(out.join('')).toContain('no dist/ produced under');
    expect(code).toBe(1);
  });
});

describe('piot verify wheel --target sdist: sdist filename version (#450)', () => {
  it('passes when the sdist filename carries the planned version', async () => {
    writeSdist('demo', '1.2.3');
    const code = await verify('sdist', '1.2.3');
    expect(out.join('')).toContain('ok sdist: demo-1.2.3.tar.gz');
    expect(code).toBe(0);
  });

  it('fails when the sdist filename does not contain the planned version', async () => {
    writeSdist('demo', '0.9.0');
    const code = await verify('sdist', '1.2.3');
    expect(out.join('')).toContain("does not contain planned version '1.2.3'");
    expect(code).toBe(1);
  });

  it('fails when no sdist was produced', async () => {
    distDir();
    const code = await verify('sdist', '1.2.3');
    expect(out.join('')).toContain('no sdist produced in');
    expect(code).toBe(1);
  });
});
