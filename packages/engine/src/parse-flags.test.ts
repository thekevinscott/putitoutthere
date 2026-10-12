import { describe, expect, it, vi } from 'vitest';

import { parseFlags } from './parse-flags.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));

describe('parseFlags', () => {
  it('defaults every boolean to false and cwd to the process cwd', () => {
    expect(parseFlags([])).toEqual({
      cwd: process.cwd(),
      json: false,
      check: false,
      dryRun: false,
      noDefaultFeatures: false,
      perTriple: false,
    });
  });

  it('resolves a relative --cwd to an absolute path (#244)', () => {
    const flags = parseFlags(['--cwd', 'fixture-tree']);
    expect(flags.cwd).not.toBe('fixture-tree');
    expect(flags.cwd.endsWith('fixture-tree')).toBe(true);
  });

  it('keeps the default cwd when --cwd is passed with no value', () => {
    const flags = parseFlags(['--cwd']);
    expect(flags.cwd).toBe(process.cwd());
  });

  it('leaves an already-absolute --cwd untouched', () => {
    const flags = parseFlags(['--cwd', '/tmp/abs-path-test']);
    expect(flags.cwd).toBe('/tmp/abs-path-test');
  });

  it('does not normalise an absolute --cwd', () => {
    expect(parseFlags(['--cwd', '/w/../x/']).cwd).toBe('/w/../x/');
  });

  it('reads no index past the end of argv', () => {
    const read: number[] = [];
    const argv = new Proxy(['--json'], {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {read.push(Number(key));}
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    parseFlags(argv);
    expect(read).toEqual([0]);
  });

  it('parses --release-packages', () => {
    const flags = parseFlags(['--release-packages', 'lib-core@minor, lib-js']);
    expect(flags.releasePackages).toBe('lib-core@minor, lib-js');
  });

  it('leaves releasePackages undefined when --release-packages is absent', () => {
    const flags = parseFlags(['--cwd', '/tmp/x']);
    expect(flags.releasePackages).toBeUndefined();
  });

  it('parses the verify / write / fold flag family', () => {
    const flags = parseFlags([
      '--config', '/c/piot.toml',
      '--matrix', '[]',
      '--registry', 'https://reg',
      '--registry-root', '/root',
      '--target', 'sdist',
      '--manylinux', '2_28',
      '--subject', 'chore: bundle',
      '--stage-to', 'wheel/dir',
      '--bin', 'demo',
      '--per-triple',
    ]);
    expect(flags.config).toBe('/c/piot.toml');
    expect(flags.matrix).toBe('[]');
    expect(flags.registry).toBe('https://reg');
    expect(flags.registryRoot).toBe('/root');
    expect(flags.target).toBe('sdist');
    expect(flags.manylinux).toBe('2_28');
    expect(flags.subject).toBe('chore: bundle');
    expect(flags.stageTo).toBe('wheel/dir');
    expect(flags.bin).toBe('demo');
    expect(flags.perTriple).toBe(true);
  });

  it('parses the output, build and dry-run flags', () => {
    const flags = parseFlags([
      '--cwd', '/w',
      '--json',
      '--check',
      '--path', 'pkg/a',
      '--version', '1.2.3',
      '--build', 'napi',
      '--features', 'a,b',
      '--no-default-features',
      '--dry-run',
    ]);
    expect(flags).toEqual({
      cwd: '/w',
      json: true,
      check: true,
      dryRun: true,
      noDefaultFeatures: true,
      perTriple: false,
      path: 'pkg/a',
      version: '1.2.3',
      build: 'napi',
      features: 'a,b',
    });
  });

  it('ignores unknown arguments', () => {
    expect(parseFlags(['--cwd', '/w', '--nope', 'stray'])).toEqual({
      cwd: '/w',
      json: false,
      check: false,
      dryRun: false,
      noDefaultFeatures: false,
      perTriple: false,
    });
  });

  it('leaves manylinux undefined when --manylinux is absent (#610)', () => {
    expect(parseFlags(['--target', 'sdist']).manylinux).toBeUndefined();
  });

  it('parses --expect as one opaque value, JSON array included (#666)', () => {
    const raw = '[{"name":"demo","version":"1.2.3"}]';
    expect(parseFlags(['--expect', raw]).expect).toBe(raw);
    expect(parseFlags(['--expect', '@acme/widget@1.2.3']).expect).toBe('@acme/widget@1.2.3');
  });

  it('leaves expect undefined when --expect is absent (#666)', () => {
    expect(parseFlags(['--cwd', '/tmp/x']).expect).toBeUndefined();
  });
});
