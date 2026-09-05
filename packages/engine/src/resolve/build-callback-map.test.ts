import { describe, expect, it } from 'vitest';

import { buildCallbackMap } from './build-callback-map.js';

const KEY = 'owner/repo/.github/workflows/wf.yml:plan';

describe('buildCallbackMap', () => {
  it('keys every entry under the single callback key, in document order', () => {
    const map = buildCallbackMap(KEY, [
      { fixture: 'a', matrix: [], has_pypi: false },
      { fixture: 'b', matrix: [], has_pypi: false },
    ]);
    expect(Object.keys(map)).toEqual([KEY]);
    expect(map[KEY]!.map((e) => e.inputs)).toEqual([{ fixture: 'a' }, { fixture: 'b' }]);
  });

  it('double-encodes the matrix exactly as $GITHUB_OUTPUT carries it', () => {
    const map = buildCallbackMap(KEY, [
      { fixture: 'a', matrix: [{ name: 'pkg', version: '0.0.0' }], has_pypi: false },
    ]);
    expect(map[KEY]![0]!.outputs.matrix).toBe('[{"name":"pkg","version":"0.0.0"}]');
  });

  it('renders has_pypi as the step\'s string true/false', () => {
    const map = buildCallbackMap(KEY, [
      { fixture: 'py', matrix: [{ kind: 'pypi' }], has_pypi: true },
      { fixture: 'js', matrix: [{ kind: 'npm' }], has_pypi: false },
    ]);
    expect(map[KEY]![0]!.outputs.has_pypi).toBe('true');
    expect(map[KEY]![1]!.outputs.has_pypi).toBe('false');
  });
});
