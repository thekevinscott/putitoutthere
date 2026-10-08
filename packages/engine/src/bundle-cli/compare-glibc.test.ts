import { expect, it } from 'vitest';

import { compareGlibc } from './compare-glibc.js';

it.each([
  ['GLIBC_2.4', 'GLIBC_2.17', -1],
  ['GLIBC_2.17', 'GLIBC_2.4', 1],
  ['GLIBC_2.17', 'GLIBC_2.17', 0],
  ['GLIBC_2.2.5', 'GLIBC_2.2', 1],
  ['GLIBC_2.2', 'GLIBC_2.2.5', -1],
  ['GLIBC_2.3.4', 'GLIBC_2.14', -1],
  ['GLIBC_3.0', 'GLIBC_2.34', 1],
])('%s vs %s orders as sort -V does (%i)', (a, b, sign) => {
  expect(Math.sign(compareGlibc(a, b))).toBe(sign);
});
