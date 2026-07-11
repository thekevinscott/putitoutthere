/**
 * `formatStatusRow` (#403): the single-line, non-`--json` render of one
 * status row. Pins the mark selection (✓ / ? / ⚠) and the `—` fallbacks
 * for a missing tag version or registry version.
 */

import { describe, expect, it } from 'vitest';

import type { StatusRow } from './status-types.js';
import { formatStatusRow } from './status-format.js';

function row(overrides: Partial<StatusRow>): StatusRow {
  return {
    package: 'demo',
    kind: 'crates',
    tag: 'demo-v1.0.0',
    tagVersion: '1.0.0',
    registry: '1.0.0',
    registryUnreachable: false,
    state: 'in sync',
    drift: false,
    ...overrides,
  };
}

describe('formatStatusRow', () => {
  it('renders a ✓ for an in-sync, non-drift row', () => {
    expect(formatStatusRow(row({}))).toBe('demo  tag=1.0.0  registry=1.0.0  ✓ in sync');
  });

  it('renders a ⚠ and the drift state when the row is drifting', () => {
    const out = formatStatusRow(
      row({ registry: null, state: 'tagged, unpublished', drift: true }),
    );
    expect(out).toBe('demo  tag=1.0.0  registry=—  ⚠ tagged, unpublished');
  });

  it('renders a ? and "unreachable" when the registry could not be reached', () => {
    const out = formatStatusRow(
      row({ registry: null, registryUnreachable: true, state: 'registry unreachable' }),
    );
    expect(out).toBe('demo  tag=1.0.0  registry=unreachable  ? registry unreachable');
  });

  it('substitutes — for a missing tag version', () => {
    const out = formatStatusRow(
      row({ tag: null, tagVersion: null, state: 'published, untagged', drift: true }),
    );
    expect(out).toBe('demo  tag=—  registry=1.0.0  ⚠ published, untagged');
  });

  it('prefers the drift ⚠ over the unreachable ? when both hold', () => {
    // registryUnreachable sets ?, but drift wins the final assignment.
    const out = formatStatusRow(row({ registryUnreachable: true, drift: true }));
    expect(out.endsWith('⚠ in sync')).toBe(true);
  });
});
