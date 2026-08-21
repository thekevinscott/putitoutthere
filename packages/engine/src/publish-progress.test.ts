import { describe, expect, it } from 'vitest';

import { attachPublishProgress, readPublishProgress } from './publish-progress.js';
import type { PublishOutput } from './publish.js';

const entry = (
  name: string,
  status: 'published' | 'delegated',
): PublishOutput['published'][number] => ({
  package: name,
  version: '1.2.3',
  result: { status },
  tag: `${name}-v1.2.3`,
});

describe('publish progress carried through a throw (#623)', () => {
  it('reads back exactly what was attached', () => {
    const progress = [entry('lib-py', 'delegated'), entry('lib-rust', 'published')];
    const err = attachPublishProgress(new Error('npm publish failed'), progress);
    expect(readPublishProgress(err)).toEqual(progress);
  });

  it('returns the same Error so callers can annotate and rethrow inline', () => {
    const err = new Error('x');
    expect(attachPublishProgress(err, [])).toBe(err);
  });

  it("leaves the handler's own error untouched — message and cause survive", () => {
    // The point of annotating rather than wrapping: `publish()` rethrows
    // the handler's error, and the CLI prints its message. A wrapper would
    // replace both.
    const cause = new Error('E404 Scope not found');
    const err = new Error('npm publish failed', { cause });
    attachPublishProgress(err, [entry('lib-py', 'delegated')]);
    expect(err.message).toBe('npm publish failed');
    expect(err.cause).toBe(cause);
  });

  it('rides on a namespaced own property and adds nothing else', () => {
    // The Error it annotates is not ours: it is the handler's, and it
    // goes on to be rendered into the job summary, serialized, and read
    // by whoever debugs the failure. So the annotation has to be exactly
    // one property, attributable to piot on sight, and it must not
    // collide with what anything else puts on the same Error —
    // `attachHandlerMeta` in types.ts already annotates these errors,
    // and its key is mirrored here as the stand-in for "someone else's".
    const err = new Error('npm publish failed') as Error & { __piotHandlerMeta?: unknown };
    err.__piotHandlerMeta = { toolVersions: { npm: '12.0.0' } };

    attachPublishProgress(err, [entry('lib-py', 'delegated')]);

    const annotations = Object.getOwnPropertyNames(err)
      .filter((k) => k !== 'message' && k !== 'stack')
      .sort();
    expect(annotations).toEqual(['__piotHandlerMeta', '__piotPublishProgress']);
    // Neither annotation clobbers the other.
    expect(err.__piotHandlerMeta).toEqual({ toolVersions: { npm: '12.0.0' } });
    expect(readPublishProgress(err)).toEqual([entry('lib-py', 'delegated')]);
  });

  it('reports no progress for an Error that was never annotated', () => {
    expect(readPublishProgress(new Error('preflight failed'))).toEqual([]);
  });

  it('reports no progress for non-Error throws', () => {
    expect(readPublishProgress('a string')).toEqual([]);
    expect(readPublishProgress(undefined)).toEqual([]);
    expect(readPublishProgress(null)).toEqual([]);
  });
});
