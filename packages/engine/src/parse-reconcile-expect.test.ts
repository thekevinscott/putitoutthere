/**
 * `parseReconcileExpect` unit coverage. Pure grammar, no collaborators to
 * mock: the two accepted forms are a single `<name>@<version>` and the
 * release job's `delegated_packages` JSON array, forwarded verbatim.
 *
 * The scoped-npm case is the one that decides the split rule — `@scope/p`
 * carries an `@` of its own, so the version separator is the LAST `@`, not
 * the first. The rejection cases pin that a malformed expectation fails
 * loudly rather than resolving to a half-parsed pair, because the caller's
 * next move is to cut a tag from whatever comes back.
 *
 * Issue #666.
 */

import { describe, expect, it } from 'vitest';

import { parseReconcileExpect } from './parse-reconcile-expect.js';

describe('parseReconcileExpect: <name>@<version> form', () => {
  it('splits a plain name from its version', () => {
    expect(parseReconcileExpect('demo-pkg@1.2.3')).toEqual([
      { name: 'demo-pkg', version: '1.2.3' },
    ]);
  });

  it('splits a scoped npm name at the last @, not the first', () => {
    expect(parseReconcileExpect('@acme/widget@0.1.0-rc.1')).toEqual([
      { name: '@acme/widget', version: '0.1.0-rc.1' },
    ]);
  });

  it('trims surrounding whitespace before splitting', () => {
    expect(parseReconcileExpect('  demo-pkg@1.2.3\n')).toEqual([
      { name: 'demo-pkg', version: '1.2.3' },
    ]);
  });

  it('rejects a spec with no @ at all', () => {
    expect(() => parseReconcileExpect('demo-pkg')).toThrow(
      /expected "<name>@<version>" or a JSON array, got "demo-pkg"/,
    );
  });

  it('rejects a spec whose @ leaves an empty name', () => {
    expect(() => parseReconcileExpect('@1.2.3')).toThrow(/got "@1\.2\.3"/);
  });

  it('rejects a spec whose @ leaves an empty version', () => {
    expect(() => parseReconcileExpect('demo-pkg@')).toThrow(/got "demo-pkg@"/);
  });

  it('quotes the raw spec, not the trimmed one, so stray whitespace is visible', () => {
    expect(() => parseReconcileExpect('  demo-pkg  ')).toThrow('got "  demo-pkg  "');
  });
});

describe('parseReconcileExpect: JSON array form', () => {
  it('accepts the release job\'s delegated_packages rows and ignores extra keys', () => {
    const raw = JSON.stringify([
      { name: 'first-pkg', version: '1.0.0', tag: 'first-pkg-v1.0.0', kind: 'pypi' },
      { name: 'second-pkg', version: '2.0.0' },
    ]);

    expect(parseReconcileExpect(raw)).toEqual([
      { name: 'first-pkg', version: '1.0.0' },
      { name: 'second-pkg', version: '2.0.0' },
    ]);
  });

  it('accepts an empty array as an empty expectation', () => {
    expect(parseReconcileExpect('[]')).toEqual([]);
  });

  it('detects the JSON form after trimming leading whitespace', () => {
    expect(parseReconcileExpect('  [{"name":"p","version":"1.0.0"}]')).toEqual([
      { name: 'p', version: '1.0.0' },
    ]);
  });

  it('reports the parser message and keeps the parse error as the cause', () => {
    let thrown: unknown;
    try {
      parseReconcileExpect('[{"name":');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/^reconcile --expect: invalid JSON: .+/);
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('names the offending index when an entry has no string name', () => {
    expect(() => parseReconcileExpect('[{"version":"1.0.0"}]')).toThrow(
      'reconcile --expect: entry 0 is missing a string "name" or "version"',
    );
  });

  it('names the offending index when an entry has no string version', () => {
    const raw = '[{"name":"ok","version":"1.0.0"},{"name":"bad","version":7}]';

    expect(() => parseReconcileExpect(raw)).toThrow(/entry 1 is missing/);
  });

  it('rejects a null entry rather than reading through it', () => {
    expect(() => parseReconcileExpect('[null]')).toThrow(/entry 0 is missing/);
  });
});
