import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSubprocessEnv, nonEmpty } from './env.js';

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

describe('buildSubprocessEnv (#138)', () => {
  const ENV_BAK = { ...process.env };
  beforeEach(() => {
    process.env.UNRELATED_AWS_SECRET = 'leak';
    process.env.PATH = process.env.PATH ?? '/usr/bin';
    process.env.HOME = process.env.HOME ?? '/tmp';
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ENV_BAK)) delete process.env[k];
    }
    Object.assign(process.env, ENV_BAK);
  });

  it('passes PATH / HOME through from the parent env', () => {
    const out = buildSubprocessEnv();
    expect(out.PATH).toBe(process.env.PATH);
    expect(out.HOME).toBe(process.env.HOME);
  });

  it('does not forward unrelated parent secrets', () => {
    const out = buildSubprocessEnv();
    expect(out.UNRELATED_AWS_SECRET).toBeUndefined();
  });

  it('forwards declared ctx.env vars (including tokens)', () => {
    const out = buildSubprocessEnv({ CARGO_REGISTRY_TOKEN: 'abc' });
    expect(out.CARGO_REGISTRY_TOKEN).toBe('abc');
  });

  it('merges extras last so handlers can set fixed overrides', () => {
    const out = buildSubprocessEnv(
      { CARGO_TERM_VERBOSE: 'false' },
      { CARGO_TERM_VERBOSE: 'true' },
    );
    expect(out.CARGO_TERM_VERBOSE).toBe('true');
  });

  it('drops undefined values from ctx.env and extras', () => {
    const out = buildSubprocessEnv(
      { DEFINED: 'yes', MISSING: undefined },
      { EXTRA: undefined },
    );
    expect(out.DEFINED).toBe('yes');
    expect(out.MISSING).toBeUndefined();
    expect(out.EXTRA).toBeUndefined();
  });
});
