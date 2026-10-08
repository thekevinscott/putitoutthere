import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '../../../dist/cli-bin.js');

function verify(binary: string | undefined, target: string): { code: number; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'piot-bundle-cli-verify-e2e-'));
  if (binary !== undefined) {copyFileSync(binary, join(dir, 'tool'));}
  try {
    return { code: 0, stdout: execFileSync('node', [CLI, 'bundle-cli-verify', '--path', dir, '--bin', 'tool', '--target', target], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, stdout: e.stdout };
  }
}

describe.runIf(process.platform === 'linux')('bundle-cli-verify against real binaries, `file` and `objdump`', () => {
  it('fails a runner-built binary whose glibc requirement exceeds the 2.17 floor', () => {
    const { code, stdout } = verify('/bin/true', 'x86_64-unknown-linux-gnu');
    expect(code).toBe(1);
    expect(stdout).toMatch(/::error::bundle_cli binary .*\/tool requires GLIBC_2\.\d+, exceeding the GLIBC_2\.17 portability floor/);
  });

  it('fails a static-pie gnu binary, which cannot dlopen', () => {
    const { code, stdout } = verify('/sbin/ldconfig.real', 'x86_64-unknown-linux-gnu');
    expect(code).toBe(1);
    expect(stdout).toContain('is statically linked — a static binary cannot dlopen');
  });

  it('accepts the same static binary for a declared musl triple', () => {
    const { code, stdout } = verify('/sbin/ldconfig.real', 'x86_64-unknown-linux-musl');
    expect(code).toBe(0);
    expect(stdout).toContain('targets musl — static linkage is expected here');
  });

  it('fails when nothing was staged', () => {
    const { code, stdout } = verify(undefined, 'x86_64-unknown-linux-gnu');
    expect(code).toBe(1);
    expect(stdout).toMatch(/::error::bundle_cli staged binary missing at .*\/tool\n/);
  });
});
