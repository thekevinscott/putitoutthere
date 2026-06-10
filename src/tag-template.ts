/**
 * Tag-name template: how putitoutthere derives the git tag from a
 * `(name, version)` pair and how it parses a version back out of a tag.
 *
 * Template placeholders:
 *   - `{version}` — required. Replaced with the semver string on format,
 *     captured on parse.
 *   - `{name}` — optional. Replaced with the package name when present.
 *     Useful to distinguish packages in polyglot repos; omit it when a
 *     single-package repo wants the classic `v{version}` shape.
 *
 * Defaults to `{name}-v{version}` (matches the historical shape this
 * tool emitted before the template became configurable).
 *
 * Issue #TBD (tag-format config).
 */

import { parseSemver } from './version.js';

export const DEFAULT_TAG_FORMAT = '{name}-v{version}';

/** Render a tag from a `(name, version)` pair. */
export function formatTag(template: string, vars: { name: string; version: string }): string {
  return template.replace(/\{name\}/g, vars.name).replace(/\{version\}/g, vars.version);
}

/**
 * `git tag -l` glob for a given package. `{name}` becomes the literal
 * package name; `{version}` becomes `*.*.*` so we only list semver-shaped
 * candidates.
 */
export function tagGlob(template: string, name: string): string {
  return template.replace(/\{name\}/g, name).replace(/\{version\}/g, '*.*.*');
}

/**
 * Pull the version out of a tag. Returns `null` when the tag doesn't
 * match the template or the captured string isn't strict semver.
 */
export function parseTagVersion(
  template: string,
  name: string,
  tag: string,
): string | null {
  const re = templateToRegex(template, name);
  const m = re.exec(tag);
  if (!m) {return null;}
  const versionPart = m[1]!;
  try {
    parseSemver(versionPart);
  } catch {
    return null;
  }
  return versionPart;
}

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
  if (unknown && unknown.length > 0) {
    return `tag_format contains unknown placeholder(s): ${unknown.join(', ')}`;
  }
  return null;
}

function templateToRegex(template: string, name: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\\\{name\\\}/g, escapeRegex(name))
    .replace(/\\\{version\\\}/g, '(.+)');
  return new RegExp(`^${pattern}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
