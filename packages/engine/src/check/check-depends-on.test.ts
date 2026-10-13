import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertNoCycles } from '../assert-no-cycles.js';
import type { Package } from '../config.js';
import { checkDependsOn } from './check-depends-on.js';
import type { CheckFinding } from '../check.js';

vi.mock('../assert-no-cycles.js');

const assertNoCyclesMock = vi.mocked(assertNoCycles);

const packages = [{ name: 'a', depends_on: [] }] as unknown as readonly Package[];

beforeEach(() => {
  assertNoCyclesMock.mockReset();
});

describe('checkDependsOn', () => {
  it('validates the packages and adds no finding when the graph is sound', () => {
    const findings: CheckFinding[] = [];
    checkDependsOn(packages, findings);
    expect(assertNoCyclesMock).toHaveBeenCalledWith(packages);
    expect(findings).toEqual([]);
  });

  it('converts a validation error into a finding instead of throwing', () => {
    assertNoCyclesMock.mockImplementation(() => {
      throw new Error('putitoutthere.toml: depends_on cycle: a → a');
    });
    const findings: CheckFinding[] = [];
    checkDependsOn(packages, findings);
    expect(findings).toEqual([{ message: 'putitoutthere.toml: depends_on cycle: a → a' }]);
  });

  it('keeps findings already collected', () => {
    assertNoCyclesMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const findings: CheckFinding[] = [{ message: 'earlier' }];
    checkDependsOn(packages, findings);
    expect(findings).toEqual([{ message: 'earlier' }, { message: 'boom' }]);
  });
});
