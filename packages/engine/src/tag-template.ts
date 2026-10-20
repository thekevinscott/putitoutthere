/**
 * Tag-name template: how putitoutthere derives a git tag from `(name, version)`
 * and parses a version back out. `{version}` is required (captured on parse);
 * `{name}` is optional — omit it for a single-package repo's classic
 * `v{version}`. Defaults to `{name}-v{version}`, the historical shape.
 */

import { templateToRegex } from './template-to-regex.js';
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
