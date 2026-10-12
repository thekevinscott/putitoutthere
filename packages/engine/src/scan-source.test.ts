import { describe, expect, it, vi } from 'vitest';

import { scanSource } from './scan-source.js';

describe('scanSource', () => {
  it('returns values of *TOKEN*, *SECRET*, *PASSWORD*, *PAT* and trailing *KEY names', () => {
    const values = scanSource({
      CARGO_REGISTRY_TOKEN: 'AAAAAAAA1',
      MY_SECRET: 'BBBBBBBB1',
      DATABASE_PASSWORD: 'CCCCCCCC1',
      GH_PAT: 'DDDDDDDD1',
      ENCRYPTION_KEY: 'EEEEEEEE1',
      APIKEY: 'FFFFFFFF1',
      TOKEN: 'GGGGGGGG1',
    });
    expect([...values].sort()).toEqual([
      'AAAAAAAA1', 'BBBBBBBB1', 'CCCCCCCC1', 'DDDDDDDD1', 'EEEEEEEE1', 'FFFFFFFF1', 'GGGGGGGG1',
    ]);
  });

  it('matches names case-insensitively', () => {
    expect(scanSource({ my_token: 'lowercased-value-1234' })).toEqual(['lowercased-value-1234']);
  });

  it('skips names that only contain a credential substring (#196)', () => {
    expect(
      scanSource({
        KEYCLOAK_URL: 'https://auth.example.com/realms/main',
        TOKENIZER_MODEL: 'bert-base-uncased',
        TOKENS_PER_SECOND: 'rate-limit-100',
        PUBLIC_KEY_PATH: '/etc/ssl/certs/public.pem',
        PASSTHROUGH: 'enabled-by-default',
        PASSPORT_URL: 'https://passport.example.com/oauth',
        PATHWAY_URL: 'https://pathway.example.com/api',
        PATS_COUNT: 'sixteen-characters',
        PROJECT_NAME: 'example-lib-name',
        SUBTOKEN: 'embedded-not-bounded',
      }),
    ).toEqual([]);
  });

  it('skips values under 8 chars and keeps values of exactly 8 (#137)', () => {
    expect(scanSource({ SHORT_TOKEN: 'abcdefg', EXACT_TOKEN: 'abcdefgh' })).toEqual(['abcdefgh']);
  });

  it('skips empty and undefined values', () => {
    expect(scanSource({ EMPTY_TOKEN: '', MAYBE_TOKEN: undefined, GOOD_TOKEN: 'realtokenvalue' })).toEqual([
      'realtokenvalue',
    ]);
  });

  it('orders values longest-first', () => {
    expect(scanSource({ A_TOKEN: 'short-tok', B_TOKEN: 'much-longer-token', C_TOKEN: 'medium-token' })).toEqual([
      'much-longer-token',
      'medium-token',
      'short-tok',
    ]);
  });

  it('caches the scan for an unchanged source (#141)', () => {
    const src = { PERF_CHECK_TOKEN: 'perf-checksecret' };
    const first = scanSource(src);
    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    try {
      expect(scanSource(src)).toBe(first);
      expect(sortSpy).not.toHaveBeenCalled();
    } finally {
      sortSpy.mockRestore();
    }
  });

  it.each([
    ['a value change', (s: Record<string, string>) => { s.MUT_TOKEN = 'differentsecrethere'; }],
    ['an added key', (s: Record<string, string>) => { s.NEW_TOKEN = 'addedsecretvalue'; }],
    ['an equal-length rename', (s: Record<string, string>) => { delete s.MUT_TOKEN; s.XUT_TOKEN = 'firstsecretvalue'; }],
    ['a key and value each growing by one', (s: Record<string, string>) => { delete s.MUT_TOKEN; s.MUTT_TOKEN = 'firstsecretvalue1'; }],
    ['a first-byte bump with a value growing by one', (s: Record<string, string>) => { delete s.MUT_TOKEN; s.NUT_TOKEN = 'firstsecretvalue1'; }],
  ])('rescans after %s in place (#141)', (_label, mutate) => {
    const src: Record<string, string> = { MUT_TOKEN: 'firstsecretvalue' };
    const first = scanSource(src);
    mutate(src);
    const second = scanSource(src);
    expect(second).not.toBe(first);
    expect([...second].sort()).toEqual(Object.values(src).sort());
  });

  it('rescans when an undefined value becomes a 17-char secret', () => {
    const src: Record<string, string | undefined> = { LATE_TOKEN: undefined };
    expect(scanSource(src)).toEqual([]);
    src.LATE_TOKEN = 'seventeen-chars-x';
    expect(scanSource(src)).toEqual(['seventeen-chars-x']);
  });
});
