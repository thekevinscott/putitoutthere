import { describe, expect, it } from 'vitest';

import { validateTagFormat } from './validate-tag-format.js';

describe('validateTagFormat', () => {
  it('accepts the default', () => {
    expect(validateTagFormat('{name}-v{version}')).toBeNull();
  });

  it('accepts `v{version}`', () => {
    expect(validateTagFormat('v{version}')).toBeNull();
  });

  it('requires {version}', () => {
    expect(validateTagFormat('{name}-v')).toBe('tag_format must contain {version}');
  });

  it('lists every unknown placeholder', () => {
    expect(validateTagFormat('{name}-{bogus}-{x}-v{version}')).toBe(
      'tag_format contains unknown placeholder(s): {bogus}, {x}',
    );
  });

  it('flags an empty placeholder', () => {
    expect(validateTagFormat('{}v{version}')).toBe('tag_format contains unknown placeholder(s): {}');
  });

  it('flags a placeholder that only starts like a known one', () => {
    expect(validateTagFormat('{names}-v{version}')).toBe(
      'tag_format contains unknown placeholder(s): {names}',
    );
  });
});
