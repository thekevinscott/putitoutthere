import { describe, expect, it } from 'vitest';
import { handlerFor } from './index.js';

describe('handlerFor', () => {
  it('dispatches to the crates handler', () => {
    expect(handlerFor('crates').kind).toBe('crates');
  });

  it('dispatches to the pypi handler', () => {
    expect(handlerFor('pypi').kind).toBe('pypi');
  });

  it('dispatches to the npm handler', () => {
    expect(handlerFor('npm').kind).toBe('npm');
  });

  it('throws on unknown kind', () => {
    // Casting around the exhaustive union so we can exercise the default arm.
    expect(() => handlerFor('rubygems' as never)).toThrow(/unknown package kind/);
  });
});
