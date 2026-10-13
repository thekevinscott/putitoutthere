import { describe, expect, it } from 'vitest';

import { validateNameTemplate } from './validate-name-template.js';

describe('validateNameTemplate', () => {
  it('accepts a template using only allowed placeholders', () => {
    expect(validateNameTemplate('@{scope}/{base}-{mode}-{triple}')).toBeNull();
    expect(validateNameTemplate('{name}-{triple}')).toBeNull();
  });

  it('rejects an empty template', () => {
    expect(validateNameTemplate('')).toBe('name template must not be empty');
  });

  it('rejects a template missing {triple}', () => {
    expect(validateNameTemplate('{name}-cli')).toBe(
      'name template must contain {triple} (otherwise platform packages would collide)',
    );
  });

  it('lists each unknown placeholder once, alongside the allowed set', () => {
    expect(validateNameTemplate('{name}-{version}-{triple}-{version}-{os}')).toBe(
      'name template contains unknown placeholder(s): {version}, {os} (allowed: {name}, {scope}, {base}, {triple}, {mode})',
    );
  });
});
