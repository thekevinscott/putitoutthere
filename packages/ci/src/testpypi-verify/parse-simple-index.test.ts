/**
 * Pins `parseSimpleIndexHrefs` over a realistic PEP 503 page: it collects
 * anchor hrefs in document order, ignores non-anchor tags (meta/title/link),
 * skips anchors with empty or absent href, and confines href extraction to the
 * tag itself (a stray `href="..."` in anchor *text* must not be picked up).
 */

import { describe, expect, it } from 'vitest';

import { parseSimpleIndexHrefs } from './parse-simple-index.js';

const PAGE = [
  '<!DOCTYPE html>',
  '<html>',
  '  <head>',
  '    <meta name="pypi:repository-version" content="1.1">',
  '    <title>Links for foo</title>',
  '    <link rel="canonical" href="https://ignored/link">',
  '  </head>',
  '  <body>',
  '    <h1>Links for foo</h1>',
  '    <a href="https://files/foo-1.0.tar.gz#sha256=aaa">foo-1.0.tar.gz</a><br/>',
  '    <a href="https://files/foo-1.0-py3-none-any.whl#sha256=bbb">foo-1.0-py3-none-any.whl</a><br/>',
  '    <a name="top">skip: no href</a>',
  '    <a href="">skip: empty href</a>',
  '    <a class="doc">see href="https://files/decoy.tar.gz" in text</a>',
  '  </body>',
  '</html>',
].join('\n');

describe('parseSimpleIndexHrefs', () => {
  it('collects only the anchor hrefs, in document order', () => {
    expect(parseSimpleIndexHrefs(PAGE)).toEqual([
      'https://files/foo-1.0.tar.gz#sha256=aaa',
      'https://files/foo-1.0-py3-none-any.whl#sha256=bbb',
    ]);
  });

  it('does not pick up an href that appears in anchor text rather than the tag', () => {
    expect(parseSimpleIndexHrefs(PAGE)).not.toContain('https://files/decoy.tar.gz');
  });

  it('returns an empty list when there are no tags', () => {
    expect(parseSimpleIndexHrefs('no tags here')).toEqual([]);
  });
});
