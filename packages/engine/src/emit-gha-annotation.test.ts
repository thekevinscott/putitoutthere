import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { emitGhaAnnotation } from './emit-gha-annotation.js';
import type { FailureContext } from './verbose-types.js';

const ctx: FailureContext = {
  package: 'demo',
  handler: 'crates',
  command: ['cargo', 'publish'],
  stdout: '',
  stderr: '',
  exitCode: 1,
};

let stdout: MockInstance<typeof process.stdout.write>;

function written(): string[] {
  return stdout.mock.calls.map((c) => String(c[0]));
}

function emit(msg: string): void {
  emitGhaAnnotation(new Error(msg), ctx, msg);
}

beforeEach(() => {
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdout.mockRestore();
  vi.unstubAllEnvs();
});

describe('emitGhaAnnotation', () => {
  it('writes one ::error:: line tagged handler/package with the message', () => {
    emit('publish failed: 401 unauthorized');
    expect(written()).toEqual(['::error::crates/demo: publish failed: 401 unauthorized\n']);
  });

  it('writes the redacted message, not the error message', () => {
    emitGhaAnnotation(new Error('leaked secret-value'), ctx, 'leaked [REDACTED:abcdef12]');
    expect(written()).toEqual(['::error::crates/demo: leaked [REDACTED:abcdef12]\n']);
  });

  it('surfaces a bracketed PIOT_ code after handler/package', () => {
    emit('pypi: no auth available [PIOT_AUTH_NO_TOKEN]');
    expect(written()).toEqual([
      '::error::crates/demo [PIOT_AUTH_NO_TOKEN]: pypi: no auth available [PIOT_AUTH_NO_TOKEN]\n',
    ]);
  });

  it('ignores a bracketed tag that is not a PIOT_ code', () => {
    emit('failed [E403]');
    expect(written()).toEqual(['::error::crates/demo: failed [E403]\n']);
  });

  it.each(['', 'false', '1'])('no-ops when GITHUB_ACTIONS is %j', (value) => {
    vi.stubEnv('GITHUB_ACTIONS', value);
    emit('local run');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('takes the first non-empty trimmed line', () => {
    emit('\n   \n  first line  \nsecond line');
    expect(written()).toEqual(['::error::crates/demo: first line\n']);
  });

  it('emits an empty body when the message has no non-empty line', () => {
    emit('\n   \n\t\n');
    expect(written()).toEqual(['::error::crates/demo: \n']);
  });

  it('keeps a head of exactly 500 chars untruncated', () => {
    const msg = 'x'.repeat(500 - 'crates/demo: '.length);
    emit(msg);
    expect(written()).toEqual([`::error::crates/demo: ${msg}\n`]);
  });

  it('truncates a longer head to 500 chars ending in an ellipsis', () => {
    emit('x'.repeat(2000));
    const body = written()[0]!.slice('::error::'.length, -1);
    expect(body).toBe(`crates/demo: ${'x'.repeat(500 - 'crates/demo: '.length - 1)}…`);
  });

  it('collapses carriage returns into a single line', () => {
    emit('first\r\rsecond');
    expect(written()).toEqual(['::error::crates/demo: first second\n']);
  });
});
