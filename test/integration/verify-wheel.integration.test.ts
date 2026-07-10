/**
 * `piot verify wheel` — built wheel/sdist version verification (integration).
 * Epic #442, sub-issue #450.
 *
 * Extraction of the inline "Verify wheel/sdist version matches
 * matrix.version" bash block (#276) in `.github/workflows/e2e-fixture-job.yml`
 * into one tested engine subcommand. The contract: the build artifact under
 * `<path>/dist` carries the planned version — a wheel's `*.dist-info/METADATA`
 * `Version:` must equal it, and an sdist's filename must contain it.
 *
 * This tier drives the CLI in-process (`run([...])`) against real `.whl`
 * (a real deflate-compressed zip, built here in pure Node) and `.tar.gz`
 * files on disk — deterministic, no network, cross-platform (no `unzip`).
 * The e2e twin (`test/e2e/verify-wheel.e2e.test.ts`) shells out to the
 * built CLI against a real published wheel.
 *
 * Contract preserved verbatim from the bash: same file selection, same
 * `::error::` strings, same `ok wheel:` / `ok sdist:` lines, same exit code.
 *
 * Red before the command exists: `verify wheel` is an unrecognized
 * subcommand, so `run` errors and no `ok` line is emitted.
 */

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

/* ------- minimal, pure-Node zip writer (deflate) for .whl fixtures ------- */

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 8); // method: deflate
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const localOffset = offset;
    local.push(lfh, nameBuf, comp);
    offset += lfh.length + nameBuf.length + comp.length;
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(localOffset, 42);
    central.push(cdh, nameBuf);
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const n = Object.keys(files).length;
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, eocd]);
}

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
