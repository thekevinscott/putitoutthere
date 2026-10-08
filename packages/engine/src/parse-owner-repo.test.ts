import { describe, expect, it } from 'vitest';

import { parseOwnerRepo } from './parse-owner-repo.js';

describe('parseOwnerRepo', () => {
  it.each([
    'git+https://github.com/acme/widget.git',
    'GIT+https://github.com/acme/widget',
    'https://github.com/acme/widget',
    'https://github.com/acme/widget.git',
    'https://github.com/acme/widget/',
    'http://github.com/acme/widget',
    'git@github.com:acme/widget.git',
    'ssh://git@github.com/acme/widget.git',
    '  https://github.com/acme/widget  ',
  ])('extracts acme/widget from %s', (url) => {
    expect(parseOwnerRepo(url)).toBe('acme/widget');
  });

  it('keeps dots, dashes, and underscores in owner and repo', () => {
    expect(parseOwnerRepo('https://github.com/a.b-c_d/e.f-g_h')).toBe('a.b-c_d/e.f-g_h');
  });

  it.each([
    'https://gitlab.com/acme/widget',
    'https://github.com/acme',
    'https://github.com/acme/widget/tree/main',
    'not a url',
  ])('returns null for %s', (url) => {
    expect(parseOwnerRepo(url)).toBeNull();
  });
});
