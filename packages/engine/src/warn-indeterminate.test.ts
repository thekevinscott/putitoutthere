import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { warnIndeterminate } from './warn-indeterminate.js';

let stdout: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdout.mockRestore();
});

describe('warnIndeterminate', () => {
  it('writes one GitHub Actions warning naming the slug and the detail', () => {
    warnIndeterminate('acme/widget', 'GitHub API returned 403');
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(
      '::warning::repository visibility check skipped for acme/widget: GitHub API returned 403\n',
    );
  });
});
