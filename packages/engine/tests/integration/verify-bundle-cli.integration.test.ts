/**
 * `piot verify bundle-cli` — bundled-CLI wheel-contents verification
 * (integration). Epic #442, sub-issue #451.
 *
 * Extraction of the inline "bundle_cli — verify wheel contains
 * <stage_to>/<bin>" bash block in `.github/workflows/_matrix.yml` (#282/#358)
 * into one tested engine subcommand — the last member of the `verify`
 * family after npm-tarball (#443), crate (#449), and wheel (#450). The
 * contract, per that step: a maturin bundled-CLI build must stage its
 * cross-compiled binary into the wheel at a path ending `<stage_to>/<bin>`
 * (with `[tool.maturin].python-source` subtracted from the front of
 * `stage_to`, and a `.exe` suffix on Windows targets). Without it, a build
 * that silently failed to stage the binary would still ship a wheel and go
 * green — the release surprise the no-surprises commitment exists to catch.
 *
 * This tier drives the CLI in-process (`run([...])`) against real `.whl`
 * files (genuine deflate-compressed zips, built here in pure Node) on disk
 * — deterministic, no network, cross-platform (no `unzip`). The e2e twin
 * (`tests/e2e/verify-bundle-cli.e2e.test.ts`) shells out to the built CLI
 * against a real published wheel downloaded from PyPI.
 *
 * Contract preserved verbatim from the bash: same wheel selection, same
 * python-source stripping, same `(^|/)<stage_suffix>/<expected>$` match,
 * same `::error::` / `ok bundle_cli:` strings, same exit code.
 *
 * Red before the command exists: `verify bundle-cli` is an unrecognized
 * subcommand, so `run` errors and no `ok bundle_cli:` line is emitted.
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

/** Write a real deflate `.whl` under `<pkg>/dist` carrying `entries`. */
function writeWheel(entries: Record<string, string>): void {
  writeFileSync(join(distDir(), 'demo-1.0.0-cp312-cp312-linux_x86_64.whl'), zip(entries));
}

function writePyproject(body: string): void {
  writeFileSync(join(pkg, 'pyproject.toml'), body);
}

const NON_WINDOWS = 'x86_64-unknown-linux-gnu';
const WINDOWS = 'x86_64-pc-windows-msvc';

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-bundle-cli-'));
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

function verify(stageTo: string, bin: string, target = NON_WINDOWS): Promise<number> {
  return run([
    'node', 'piot', 'verify', 'bundle-cli',
    '--path', pkg, '--stage-to', stageTo, '--bin', bin, '--target', target,
  ]);
}

describe('piot verify bundle-cli: staged binary present in wheel (#451)', () => {
  it('passes when the wheel contains <stage_to>/<bin>', async () => {
    writeWheel({
      'demo/__init__.py': '\n',
      'dirsql/_binary/dirsql': 'ELF...',
      'demo-1.0.0.dist-info/METADATA': 'Name: demo\n',
    });

    const code = await verify('dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('strips a leading ./ from stage_to', async () => {
    writeWheel({ 'stage/bin/mytool': 'ELF...' });

    const code = await verify('./stage/bin', 'mytool');

    expect(out.join('')).toContain('ok bundle_cli: stage/bin/mytool present in');
    expect(code).toBe(0);
  });

  it('subtracts [tool.maturin].python-source from the front of stage_to', async () => {
    // maturin strips the python-source dir from the wheel layout, so the
    // binary lands at dirsql/_binary/dirsql even though stage_to names
    // python/dirsql/_binary on disk.
    writePyproject('[tool.maturin]\npython-source = "python"\n');
    writeWheel({ 'dirsql/_binary/dirsql': 'ELF...' });

    const code = await verify('python/dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('honors the legacy python_source spelling', async () => {
    writePyproject('[tool.maturin]\npython_source = "python"\n');
    writeWheel({ 'dirsql/_binary/dirsql': 'ELF...' });

    const code = await verify('python/dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('appends .exe to the expected binary on a Windows target', async () => {
    writeWheel({ 'stage/bin/mytool.exe': 'MZ...' });

    const code = await verify('stage/bin', 'mytool', WINDOWS);

    expect(out.join('')).toContain('ok bundle_cli: stage/bin/mytool.exe present in');
    expect(code).toBe(0);
  });

  it('fails with a diagnostic listing when the binary is missing', async () => {
    writeWheel({
      'demo/__init__.py': '\n',
      'demo-1.0.0.dist-info/METADATA': 'Name: demo\n',
    });

    const code = await verify('dirsql/_binary', 'dirsql');

    const text = out.join('');
    expect(text).toContain('missing bundle_cli binary at dirsql/_binary/dirsql');
    expect(text).toContain('wheel contents:');
    expect(text).toContain('demo/__init__.py');
    expect(code).toBe(1);
  });

  it('fails when no wheel was produced under dist/', async () => {
    distDir();
    const code = await verify('dirsql/_binary', 'dirsql');
    expect(out.join('')).toContain('no wheel produced under');
    expect(code).toBe(1);
  });

  it('fails when no dist/ directory exists at all', async () => {
    const code = await verify('dirsql/_binary', 'dirsql');
    expect(out.join('')).toContain('no wheel produced under');
    expect(code).toBe(1);
  });
});
