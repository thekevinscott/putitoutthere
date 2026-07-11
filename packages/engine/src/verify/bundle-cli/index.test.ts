/**
 * `verifyBundleCli` — the bundled-CLI wheel-contents engine command (#451).
 * Colocated unit tests over real deflate `.whl` fixtures built on disk,
 * exercising every branch: binary present, absolute vs relative `--path`,
 * Windows `.exe`, python-source stripping, missing binary (+ the `wheel
 * contents:` listing), and the no-wheel short-circuit.
 */

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyBundleCli } from './index.js';

/* ------- minimal, pure-Node zip writer (deflate) for .whl fixtures ------- */

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));}
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
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const localOffset = offset;
    local.push(lfh, nameBuf, comp);
    offset += lfh.length + nameBuf.length + comp.length;
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
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

function writeWheel(entries: Record<string, string>): void {
  const dist = join(pkg, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'demo-1.0.0-cp312-cp312-linux_x86_64.whl'), zip(entries));
}

function writePyproject(body: string): void {
  writeFileSync(join(pkg, 'pyproject.toml'), body);
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-bundle-cli-unit-'));
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(pkg, { recursive: true, force: true });
});

const opts = (over: Partial<{ cwd: string; path: string; stageTo: string; bin: string; target: string }> = {}) => ({
  cwd: '/unused', path: pkg, stageTo: 'dirsql/_binary', bin: 'dirsql', target: 'x86_64-unknown-linux-gnu', ...over,
});

describe('verifyBundleCli', () => {
  it('passes when the wheel contains <stage_to>/<bin> (absolute path)', () => {
    writeWheel({ 'demo/__init__.py': '\n', 'dirsql/_binary/dirsql': 'ELF' });
    const code = verifyBundleCli(opts());
    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in demo-1.0.0-cp312-cp312-linux_x86_64.whl');
    expect(code).toBe(0);
  });

  it('resolves a relative --path against cwd', () => {
    // pkg is `<tmp>/<base>`; drive it as cwd=<tmp>, path=<base>.
    writeWheel({ 'stage/bin/tool': 'ELF' });
    const code = verifyBundleCli(opts({ cwd: dirname(pkg), path: basename(pkg), stageTo: 'stage/bin', bin: 'tool' }));
    expect(out.join('')).toContain('ok bundle_cli: stage/bin/tool present in');
    expect(code).toBe(0);
  });

  it('appends .exe on a Windows target', () => {
    writeWheel({ 'stage/bin/tool.exe': 'MZ' });
    const code = verifyBundleCli(opts({ stageTo: 'stage/bin', bin: 'tool', target: 'x86_64-pc-windows-msvc' }));
    expect(out.join('')).toContain('ok bundle_cli: stage/bin/tool.exe present in');
    expect(code).toBe(0);
  });

  it('subtracts [tool.maturin].python-source before matching', () => {
    writePyproject('[tool.maturin]\npython-source = "python"\n');
    writeWheel({ 'dirsql/_binary/dirsql': 'ELF' });
    const code = verifyBundleCli(opts({ stageTo: 'python/dirsql/_binary' }));
    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('fails and lists contents when the binary is missing', () => {
    writeWheel({ 'demo/__init__.py': '\n', 'demo-1.0.0.dist-info/METADATA': 'Name: demo\n' });
    const code = verifyBundleCli(opts());
    const text = out.join('');
    expect(text).toContain('::error::wheel demo-1.0.0-cp312-cp312-linux_x86_64.whl missing bundle_cli binary at dirsql/_binary/dirsql');
    expect(text).toContain('wheel contents:');
    expect(text).toContain('demo/__init__.py');
    expect(text).toContain('demo-1.0.0.dist-info/METADATA');
    expect(code).toBe(1);
  });

  it('fails when no wheel is produced under dist/', () => {
    const code = verifyBundleCli(opts());
    expect(out.join('')).toContain('::error::no wheel produced under');
    expect(code).toBe(1);
  });
});
