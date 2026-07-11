import { afterEach, describe, expect, it, vi } from 'vitest';

import { printUsage } from './usage.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printUsage', () => {
  it('writes the piot-ci usage banner to stdout', () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      out.push(typeof c === 'string' ? c : c.toString());
      return true;
    });

    printUsage();

    const text = out.join('');
    expect(text).toContain('piot-ci — putitoutthere repo-internal CI gates');
    expect(text).toContain('Usage: piot-ci <command>');
  });
});
