import { describe, expect, it } from 'vitest';

import { decideAssertExpectedTags } from './assert-expected-tags.js';

const HATCH = {
  name: 'piot-fixture-zzz-python-hatch',
  version: '0.0.1700000000',
  tag: 'piot-fixture-zzz-python-hatch-v0.0.1700000000',
};
const SDIST = {
  name: 'piot-fixture-zzz-python-sdist',
  version: '0.0.1700000001',
  tag: 'piot-fixture-zzz-python-sdist-v0.0.1700000001',
};

describe('decideAssertExpectedTags', () => {
  it('passes when every expected tag is present, ignoring unrelated tags', () => {
    expect(decideAssertExpectedTags([HATCH, SDIST], [SDIST.tag, 'v0.9.0', HATCH.tag])).toEqual({
      lines: [`  tagged: ${HATCH.tag}`, `  tagged: ${SDIST.tag}`],
      exitCode: 0,
    });
  });

  it('fails naming the package and version reconcile left untagged', () => {
    // #694 verbatim: the version is on PyPI, reconcile exited 0 having
    // decided there was nothing to do, and no tag exists.
    expect(decideAssertExpectedTags([HATCH, SDIST], [HATCH.tag])).toEqual({
      lines: [
        `  tagged: ${HATCH.tag}`,
        `::error::pypi-tag-verify: ${SDIST.name}@${SDIST.version} is on PyPI but reconcile cut no ${SDIST.tag} tag (#694)`,
      ],
      exitCode: 1,
    });
  });

  it('fails when no tag was cut at all', () => {
    const decision = decideAssertExpectedTags([HATCH], []);
    expect(decision.exitCode).toBe(1);
    expect(decision.lines).toHaveLength(1);
  });
});
