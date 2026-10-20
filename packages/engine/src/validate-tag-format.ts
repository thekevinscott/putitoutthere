/**
 * Validate a template string. Returns an error message when invalid,
 * `null` when ok. Separated from Zod so `config.ts` can reuse the same
 * check if needed and tests can probe the rule directly.
 */
export function validateTagFormat(template: string): string | null {
  if (!template.includes('{version}')) {
    return 'tag_format must contain {version}';
  }
  // Reject unknown placeholders to catch typos early.
  const unknown = template.match(/\{(?!name\}|version\})[^}]*\}/g);
  if (unknown) {
    return `tag_format contains unknown placeholder(s): ${unknown.join(', ')}`;
  }
  return null;
}
