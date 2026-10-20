import { describe, expect, it } from 'vitest';

import { unmappedTripleMessage } from './unmapped-triple-message.js';

describe('unmappedTripleMessage', () => {
  it('names the triple and points at TRIPLE_MAP', () => {
    expect(unmappedTripleMessage('wasm32-wasi')).toBe(
      'Target triple "wasm32-wasi" is not mapped to npm os/cpu. Add it to TRIPLE_MAP in src/handlers/npm-platform.ts.',
    );
  });
});
