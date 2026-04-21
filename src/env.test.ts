import { describe, expect, it } from 'vitest';

import { nonEmpty } from './env.js';

describe('nonEmpty', () => {
  it('returns the string when non-empty', () => {
    expect(nonEmpty('x')).toBe('x');
  });

  it('returns undefined when empty string', () => {
    expect(nonEmpty('')).toBeUndefined();
  });

  it('returns undefined when undefined', () => {
    expect(nonEmpty(undefined)).toBeUndefined();
  });

  it('falls through with ?? so empty string does not shadow a real value', () => {
    // The exact pattern handlers use: ctx-scoped env first, process.env
    // second. Empty strings from the workflow harness must not shadow a
    // populated process.env value.
    const ctxEnv = { TOKEN: '' };
    const procEnv = { TOKEN: 'real' };
    const resolved = nonEmpty(ctxEnv.TOKEN) ?? nonEmpty(procEnv.TOKEN);
    expect(resolved).toBe('real');
  });
});
