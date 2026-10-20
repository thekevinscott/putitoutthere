import { describe, expect, it } from 'vitest';

import { formatZodError } from './format-zod-error.js';

// A ZodError-shaped stub rather than importing `zod`: the unit-lint isolation
// gate forbids that unmocked collaborator in a unit test.
type ZodErrorLike = Parameters<typeof formatZodError>[0];
const zodErrorLike = (
  issues: { path: (string | number)[]; message: string }[],
): ZodErrorLike => ({ issues }) as unknown as ZodErrorLike;

describe('formatZodError', () => {
  it('labels an empty issue path as <root>', () => {
    const err = zodErrorLike([{ path: [], message: 'whole-document problem' }]);
    expect(formatZodError(err)).toBe('<root>: whole-document problem');
  });

  it('joins a non-empty issue path with dots', () => {
    const err = zodErrorLike([{ path: ['package', 0, 'name'], message: 'bad field' }]);
    expect(formatZodError(err)).toBe('package.0.name: bad field');
  });

  it('joins several issues with "; "', () => {
    const err = zodErrorLike([
      { path: [], message: 'whole-document problem' },
      { path: ['package', 1, 'globs'], message: 'expected array' },
    ]);
    expect(formatZodError(err)).toBe(
      '<root>: whole-document problem; package.1.globs: expected array',
    );
  });
});
