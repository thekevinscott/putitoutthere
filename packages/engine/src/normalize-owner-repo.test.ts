import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeOwnerRepo } from './normalize-owner-repo.js';
import { parseOwnerRepo } from './parse-owner-repo.js';

vi.mock('./parse-owner-repo.js');

const parseMock = vi.mocked(parseOwnerRepo);

beforeEach(() => {
  parseMock.mockReset();
  parseMock.mockReturnValue(null);
});

describe('normalizeOwnerRepo', () => {
  it('returns null for undefined, empty, and blank input without parsing', () => {
    expect(normalizeOwnerRepo(undefined)).toBeNull();
    expect(normalizeOwnerRepo('')).toBeNull();
    expect(normalizeOwnerRepo('   ')).toBeNull();
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('passes a bare owner/repo slug through, trimmed, without parsing', () => {
    expect(normalizeOwnerRepo('  acme/widget  ')).toBe('acme/widget');
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('strips a trailing .git and slash from a slug', () => {
    expect(normalizeOwnerRepo('acme/widget.git')).toBe('acme/widget');
    expect(normalizeOwnerRepo('acme/widget/')).toBe('acme/widget');
    expect(normalizeOwnerRepo('acme/widget.git/')).toBe('acme/widget');
    expect(normalizeOwnerRepo('acme/.git')).toBe('acme/.git');
    expect(parseMock).not.toHaveBeenCalled();
  });

  it.each([
    'acme corp/widget',
    'acme/wid get',
    'acme/widget/extra',
    '/widget',
    'acme/',
    'x acme/widget',
    'acme/widget x',
  ])('hands %s, which is not a bare slug, to parseOwnerRepo', (value) => {
    expect(normalizeOwnerRepo(value)).toBeNull();
    expect(parseMock).toHaveBeenCalledWith(value);
  });

  it('returns what parseOwnerRepo extracts, from the trimmed value', () => {
    parseMock.mockReturnValue('acme/widget');
    expect(normalizeOwnerRepo(' https://github.com/acme/widget.git ')).toBe('acme/widget');
    expect(parseMock).toHaveBeenCalledWith('https://github.com/acme/widget.git');
  });
});
