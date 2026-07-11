/**
 * Handler dispatch by `package.kind`. Real dispatcher lands in #12;
 * per-handler impls in #16 (crates), #17 (pypi), #18–#19 (npm).
 */

import type { Handler, Kind } from '../types.js';
import { crates } from './crates.js';
import { npm } from './npm.js';
import { pypi } from './pypi.js';

export function handlerFor(kind: Kind): Handler {
  switch (kind) {
    case 'crates':
      return crates;
    case 'pypi':
      return pypi;
    case 'npm':
      return npm;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown package kind: ${String(exhaustive)}`);
    }
  }
}
