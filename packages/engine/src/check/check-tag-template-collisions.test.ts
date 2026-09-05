import { describe, expect, it } from 'vitest';

import type { Package } from '../config.js';
import { checkTagTemplateCollisions } from './check-tag-template-collisions.js';
import type { CheckFinding } from '../check.js';

describe('checkTagTemplateCollisions', () => {
  it('accepts templates that resolve to distinct tags', () => {
    const findings: CheckFinding[] = [];
    checkTagTemplateCollisions(
      [
        { name: 'a', tag_format: '{name}-v{version}' },
        { name: 'b', tag_format: '{name}-v{version}' },
      ] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([]);
  });

  it('flags two packages whose templates resolve to the same tag', () => {
    const findings: CheckFinding[] = [];
    checkTagTemplateCollisions(
      [
        { name: 'a', tag_format: 'v{version}' },
        { name: 'b', tag_format: 'v{version}' },
      ] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([
      {
        message:
          'tag_format collision: "b" and "a" both resolve to tag "v0.0.0" at the same version. Include {name} in tag_format to disambiguate.',
      },
    ]);
  });
});
