import { describe, expect, it } from 'vitest';

import { featuresEnableAbi3 } from './features-enable-abi3.js';

describe('featuresEnableAbi3', () => {
  it.each(['abi3', 'abi3-py38', 'abi3-py310', 'pyo3/abi3', 'pyo3/abi3-py39'])(
    'recognises %s',
    (feature) => {
      expect(featuresEnableAbi3(['extension-module', feature])).toBe(true);
    },
  );

  it.each(['abi3-compat', 'notabi3', 'abi3-py', 'abi3-pyx', 'extension-module'])(
    'does not mistake %s for abi3',
    (feature) => {
      expect(featuresEnableAbi3([feature])).toBe(false);
    },
  );

  it('ignores non-string entries', () => {
    expect(featuresEnableAbi3([42, null, { toString: () => 'abi3' }])).toBe(false);
  });

  it('is false when features is not an array', () => {
    expect(featuresEnableAbi3('abi3')).toBe(false);
  });
});
