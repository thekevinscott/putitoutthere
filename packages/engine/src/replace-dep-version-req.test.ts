/**
 * Unit tests for `replaceDepVersionReq` (#621). Two properties are
 * load-bearing: the requirement on a bumped path dependency MUST move (cargo
 * otherwise refuses to resolve and the build dies at exit 101), and a registry
 * dependency's MUST NOT (it would pin a version that does not exist).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { replaceDepVersionReq } from './replace-dep-version-req.js';
import { replaceInlineTableForm } from './replace-inline-table-form.js';
import { replaceSectionTableForm } from './replace-section-table-form.js';

vi.mock('./replace-inline-table-form.js');
vi.mock('./replace-section-table-form.js');

const inlineMock = vi.mocked(replaceInlineTableForm);
const sectionMock = vi.mocked(replaceSectionTableForm);

afterEach(() => {
  inlineMock.mockReset();
  sectionMock.mockReset();
});

describe('replaceDepVersionReq', () => {
  it('rewrites section tables, then inline tables on the result', () => {
    sectionMock.mockReturnValue('after-section');
    inlineMock.mockReturnValue('after-inline');
    expect(replaceDepVersionReq('source', 'demo-core', '0.4.2')).toBe('after-inline');
    expect(sectionMock).toHaveBeenCalledWith('source', 'demo-core', '0.4.2');
    expect(inlineMock).toHaveBeenCalledWith('after-section', 'demo-core', '0.4.2');
  });

  it('escapes every regex metacharacter in the key so it matches literally', () => {
    sectionMock.mockReturnValue('after-section');
    replaceDepVersionReq('source', 'a.*+?^${}()|[]\\b', '0.4.2');
    const escaped = 'a\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\b';
    expect(sectionMock).toHaveBeenCalledWith('source', escaped, '0.4.2');
    expect(inlineMock).toHaveBeenCalledWith('after-section', escaped, '0.4.2');
  });
});
