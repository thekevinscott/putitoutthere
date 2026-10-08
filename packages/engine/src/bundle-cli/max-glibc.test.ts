import { expect, it } from 'vitest';

import { maxGlibc } from './max-glibc.js';

it('returns the highest versioned GLIBC_ symbol by numeric order', () => {
  const symbols = [
    '0000000000000000      DF *UND*  0000000000000000 (GLIBC_2.2.5) free',
    '0000000000000000      DF *UND*  0000000000000000 (GLIBC_2.14) memcpy',
    '0000000000000000      DF *UND*  0000000000000000 (GLIBC_2.4) __stack_chk_fail',
    '0000000000000000      DF *UND*  0000000000000000  GLIBC_PRIVATE _dl_find',
  ].join('\n');
  expect(maxGlibc(symbols)).toBe('GLIBC_2.14');
});

it('returns undefined when nothing carries a GLIBC_ version', () => {
  expect(maxGlibc('0000000000000000  DF *UND*  (GLIBC_PRIVATE) x\n')).toBeUndefined();
});
