import { describe, expect, it } from 'vitest';

import { escapeRegex, templateToRegex } from './template-to-regex.js';

describe('escapeRegex', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    );
  });

  it('leaves plain characters alone', () => {
    expect(escapeRegex('my-pkg_1/@x')).toBe('my-pkg_1/@x');
  });
});

describe('templateToRegex', () => {
  it('anchors the default template and captures the version', () => {
    expect(templateToRegex('{name}-v{version}', 'pkg').source).toBe('^pkg-v(.+)$');
  });

  it('escapes the package name and the literal template text', () => {
    expect(templateToRegex('{name}.v{version}', 'a.b').source).toBe('^a\\.b\\.v(.+)$');
  });

  it('substitutes every {name} occurrence', () => {
    expect(templateToRegex('{name}/{name}@{version}', 'pkg').source).toBe('^pkg\\/pkg@(.+)$');
  });

  it('matches only the whole tag', () => {
    const re = templateToRegex('{version}-{name}', 'pkg');
    expect(re.exec('1.2.3-pkg')?.[1]).toBe('1.2.3');
    expect(re.test('1.2.3-pkgX')).toBe(false);
    expect(templateToRegex('{name}-v{version}', 'pkg').test('xpkg-v1.2.3')).toBe(false);
  });
});
