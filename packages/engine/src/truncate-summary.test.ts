import { describe, expect, it } from 'vitest';

import { truncateSummary } from './truncate-summary.js';

const CAP = 4 * 1024 * 1024;
const NOTE = '\n\n_… truncated. Run `gh run view --log` for the full log._\n';

describe('truncateSummary (4 MiB cap)', () => {
  it('returns a summary at exactly the cap unchanged', () => {
    const md = 'x'.repeat(CAP);
    expect(truncateSummary(md)).toBe(md);
  });

  it('cuts an oversized summary to the cap, keeping the head and appending the note', () => {
    const out = truncateSummary('x'.repeat(CAP + 1));
    expect(out).toBe('x'.repeat(CAP - NOTE.length) + NOTE);
    expect(out).toHaveLength(CAP);
  });
});
