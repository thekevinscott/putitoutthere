import { describe, expect, it } from 'vitest';

import { citedRunNeedles } from './cited-needles.js';

describe('citedRunNeedles', () => {
  it('collects every allowed-bucket citation from verified-by bullets', () => {
    const needles = citedRunNeedles([
      { line: 1, text: '- Fixed: a (verified by: e2e/x, unit/y)' },
      { line: 2, text: '- Changed: b (verified by: integration/z)' },
    ]);
    expect([...needles]).toEqual(['e2e/x', 'unit/y', 'integration/z']);
  });

  it('skips bullets with no clause and no-fixture bullets', () => {
    const needles = citedRunNeedles([
      { line: 1, text: '- Fixed: a with no citation' },
      { line: 2, text: '- Changed: b (no fixture: pure refactor)' },
      { line: 3, text: '- Fixed: c (verified by: unit/y)' },
    ]);
    expect([...needles]).toEqual(['unit/y']);
  });

  it('drops citations whose bucket is not allowed', () => {
    const needles = citedRunNeedles([{ line: 1, text: '- Fixed: a (verified by: smoke/x, unit/y)' }]);
    expect([...needles]).toEqual(['unit/y']);
  });

  it('de-duplicates a citation cited by more than one bullet', () => {
    const needles = citedRunNeedles([
      { line: 1, text: '- Fixed: a (verified by: unit/y)' },
      { line: 2, text: '- Fixed: b (verified by: unit/y)' },
    ]);
    expect([...needles]).toEqual(['unit/y']);
  });

  it('returns an empty set when there are no bullets', () => {
    expect([...citedRunNeedles([])]).toEqual([]);
  });

  it('never turns a no-fixture reason into a needle, even one shaped like a citation', () => {
    // Without the no-fixture skip, 'unit/x' here would be collected as a
    // needle to poll — a no-fixture bullet must contribute none.
    expect([...citedRunNeedles([{ line: 1, text: '- x (no fixture: unit/x)' }])]).toEqual([]);
  });
});
