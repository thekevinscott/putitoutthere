import { describe, expect, it } from 'vitest';

import { formatPretty } from './format-pretty.js';

describe('formatPretty', () => {
  it('prints the upper-cased level and msg, dropping time', () => {
    expect(formatPretty({ level: 'warn', time: 't0', msg: 'bare' })).toBe('[WARN] bare\n');
  });

  it('appends space-separated key=value pairs after two spaces', () => {
    expect(
      formatPretty({ level: 'info', time: 't0', msg: 'scalars', count: 3, ok: true, nada: null, meta: { a: 1 } }),
    ).toBe('[INFO] scalars  count=3 ok=true nada=null meta={"a":1}\n');
  });
});
