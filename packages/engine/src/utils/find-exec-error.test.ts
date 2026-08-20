import { describe, expect, it, vi } from 'vitest';

import { ExecError } from './exec-error.js';
import { findExecError } from './find-exec-error.js';

// `ExecError` is the shape this module recognises, and it recognises it by
// `instanceof` — a substitute class would make every assertion here vacuous.
// Declared as a mock that resolves to the real module, matching the seams'
// own tests, so the isolation rule is satisfied without faking identity.
vi.mock('./exec-error.js', async () => await vi.importActual<typeof import('./exec-error.js')>('./exec-error.js'));

describe('findExecError (#617)', () => {
  it('returns the error itself when it is already an ExecError', () => {
    const err = new ExecError('boom', 'out', 'err', 3);
    expect(findExecError(err)).toBe(err);
  });

  it('finds the ExecError one link down the cause chain', () => {
    // The shape every handler produces: catch the seam's ExecError, throw a
    // rendered message with it as `cause`.
    const exec = new ExecError('Command failed', '', 'npm error code E403', 1);
    expect(findExecError(new Error('npm publish failed', { cause: exec }))).toBe(exec);
  });

  it('finds it through several links', () => {
    const exec = new ExecError('Command failed', '', 'boom', 1);
    const wrapped = new Error('inner', { cause: exec });
    expect(findExecError(new Error('outer', { cause: wrapped }))).toBe(exec);
  });

  it('returns null for an error with no cause', () => {
    expect(findExecError(new Error('preflight rejected the manifest'))).toBeNull();
  });

  it('returns null when the chain ends in a non-Error cause', () => {
    // `cause` is untyped — a handler could attach anything.
    expect(findExecError(new Error('wrapped', { cause: 'a string' }))).toBeNull();
  });

  it('returns null for a non-Error input', () => {
    expect(findExecError('not an error')).toBeNull();
    expect(findExecError(undefined)).toBeNull();
  });

  it('terminates on a cyclic cause chain', () => {
    // `cause` is caller-supplied; a cycle must not hang the failure path,
    // which by definition runs when something has already gone wrong.
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(findExecError(a)).toBeNull();
  });

  /** An ExecError wrapped `depth` times, so it sits at chain index `depth`. */
  function buried(depth: number): Error {
    let err: Error = new ExecError('Command failed', '', 'boom', 1);
    for (let i = 0; i < depth; i++) {
      err = new Error(`wrap-${i}`, { cause: err });
    }
    return err;
  }

  // The two halves of the bound, asserted at the boundary rather than far
  // from it. The walk inspects indices 0..9, so index 9 is the last one it
  // reaches and index 10 is the first it does not — an off-by-one in either
  // direction flips exactly one of these.
  it('finds an ExecError at the last index the walk reaches', () => {
    expect(findExecError(buried(9))).toBeInstanceOf(ExecError);
  });

  it('gives up one link past the bound rather than walking forever', () => {
    expect(findExecError(buried(10))).toBeNull();
  });
});
