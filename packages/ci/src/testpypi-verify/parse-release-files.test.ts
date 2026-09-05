/**
 * Pins the split of TestPyPI's release-metadata document into wheels and
 * sdists, and the `null` that says "this body is not something the gate can
 * act on" — the signal that keeps an unreadable response from being mistaken
 * for a release with no artifacts.
 */

import { describe, expect, it } from 'vitest';

import { parseReleaseFiles } from './parse-release-files.js';

function urlsDocument(...urls: unknown[]): string {
  return JSON.stringify({ info: { version: '0.0.1' }, urls });
}

const WHEEL = { packagetype: 'bdist_wheel', filename: 'x-1-py3-none-any.whl', url: 'https://f/x-1-py3-none-any.whl' };
const SDIST = { packagetype: 'sdist', filename: 'x-1.tar.gz', url: 'https://f/x-1.tar.gz' };

describe('parseReleaseFiles', () => {
  it('splits the file list by artifact kind', () => {
    expect(parseReleaseFiles(urlsDocument(WHEEL, SDIST))).toEqual({
      wheels: [{ filename: WHEEL.filename, url: WHEEL.url }],
      sdists: [{ filename: SDIST.filename, url: SDIST.url }],
    });
  });

  it('keeps every wheel of a multi-platform release', () => {
    const linux = { filename: 'x-1-cp38-abi3-manylinux_2_28_x86_64.whl', url: 'https://f/linux.whl' };
    const mac = { filename: 'x-1-cp38-abi3-macosx_11_0_arm64.whl', url: 'https://f/mac.whl' };
    expect(parseReleaseFiles(urlsDocument(linux, mac, SDIST))?.wheels).toEqual([linux, mac]);
  });

  it('classifies by filename suffix, not by packagetype', () => {
    // The downstream selectors match on `.whl` / `.tar.gz`, so agreeing with
    // them by construction is what keeps a resolved file findable on disk.
    const mislabelled = { packagetype: 'sdist', filename: 'x-1-py3-none-any.whl', url: 'https://f/w.whl' };
    expect(parseReleaseFiles(urlsDocument(mislabelled))?.wheels).toEqual([
      { filename: mislabelled.filename, url: mislabelled.url },
    ]);
  });

  it('ignores files that are neither a wheel nor an sdist', () => {
    expect(parseReleaseFiles(urlsDocument({ filename: 'x-1.zip', url: 'https://f/x-1.zip' }, WHEEL))).toEqual({
      wheels: [{ filename: WHEEL.filename, url: WHEEL.url }],
      sdists: [],
    });
  });

  it('ignores entries the narrowing rejects', () => {
    expect(parseReleaseFiles(urlsDocument({ filename: 'x-1.tar.gz' }, SDIST))?.sdists).toEqual([
      { filename: SDIST.filename, url: SDIST.url },
    ]);
  });

  it('reports an empty release as empty, not unreadable', () => {
    expect(parseReleaseFiles(urlsDocument())).toEqual({ wheels: [], sdists: [] });
  });

  it.each([
    ['a non-JSON body', '<html>404</html>'],
    ['a JSON scalar', '"ok"'],
    ['null', 'null'],
    ['an object with no urls array', '{"info":{}}'],
    ['a non-array urls field', '{"urls":{}}'],
  ])('returns null for %s', (_label, body) => {
    expect(parseReleaseFiles(body)).toBeNull();
  });
});
