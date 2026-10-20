import { describe, expect, it } from 'vitest';

import type { PublishOutput } from './publish.js';
import { readPublishProgress } from './read-publish-progress.js';

const progress: PublishOutput['published'] = [
  { package: 'lib-py', version: '1.2.3', result: { status: 'delegated' }, tag: 'lib-py-v1.2.3' },
];

describe('readPublishProgress (#623)', () => {
  it('returns the progress stored on an annotated Error', () => {
    const err = Object.assign(new Error('npm publish failed'), { __piotPublishProgress: progress });
    expect(readPublishProgress(err)).toBe(progress);
  });

  it('reports no progress for an Error that was never annotated', () => {
    expect(readPublishProgress(new Error('preflight failed'))).toEqual([]);
  });

  it('reports no progress for a non-Error carrying the key', () => {
    expect(readPublishProgress({ __piotPublishProgress: progress })).toEqual([]);
  });

  it('reports no progress for non-Error throws', () => {
    expect(readPublishProgress('a string')).toEqual([]);
    expect(readPublishProgress(undefined)).toEqual([]);
    expect(readPublishProgress(null)).toEqual([]);
  });
});
