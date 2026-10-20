import { appendFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSummary } from './write-summary.js';

vi.mock('node:fs/promises');

const ORIGINAL = process.env.GITHUB_STEP_SUMMARY;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.GITHUB_STEP_SUMMARY;
  } else {
    process.env.GITHUB_STEP_SUMMARY = ORIGINAL;
  }
});

describe('writeSummary', () => {
  it('appends the markdown to $GITHUB_STEP_SUMMARY as utf8', async () => {
    process.env.GITHUB_STEP_SUMMARY = 'summary.md';
    await writeSummary('# report');
    expect(appendFile).toHaveBeenCalledWith('summary.md', '# report', 'utf8');
  });

  it('no-ops when $GITHUB_STEP_SUMMARY is unset', async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    await writeSummary('# report');
    expect(appendFile).not.toHaveBeenCalled();
  });
});
