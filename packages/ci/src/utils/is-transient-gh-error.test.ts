import { describe, expect, it, vi } from 'vitest';

import { ExecError } from './exec-error.js';
import { isTransientGhError } from './is-transient-gh-error.js';

// The predicate's `instanceof` needs the real class; importActual satisfies
// isolation the same way run.test.ts does.
vi.mock('./exec-error.js', async () => await vi.importActual<typeof import('./exec-error.js')>('./exec-error.js'));

const ghError = (stderr: string): ExecError => new ExecError('gh failed', '', stderr, 1);

describe('isTransientGhError', () => {
  it.each(['gh: Server Error (HTTP 502)', 'gh: Internal Server Error (HTTP 500)', '(HTTP 599)'])(
    'is true for an ExecError carrying a parenthesized 5xx: %s',
    (stderr) => {
      expect(isTransientGhError(ghError(stderr))).toBe(true);
    },
  );

  it.each([
    'HTTP 404: Not Found',
    'gh: Not Found (HTTP 404)',
    'HTTP 502', // no parentheses — not gh's server-error shape
    '(HTTP 50)', // truncated status
    'could not connect',
    '',
  ])('is false for an ExecError with non-5xx stderr: %s', (stderr) => {
    expect(isTransientGhError(ghError(stderr))).toBe(false);
  });

  it('is false for a non-ExecError, whatever it says', () => {
    expect(isTransientGhError(new Error('gh: Server Error (HTTP 502)'))).toBe(false);
    expect(isTransientGhError('gh: Server Error (HTTP 502)')).toBe(false);
    expect(isTransientGhError(undefined)).toBe(false);
  });
});
