/**
 * Rewrite the `version = "…"` requirement on a **path** dependency, preserving
 * the rest of the manifest byte-for-byte (#621). A stale requirement stops cargo
 * dead at exit 101 — "failed to select a version for the requirement
 * demo-core = ^0.2". Only path-carrying entries are touched: rewriting pyo3's
 * `0.22` would pin a version that does not exist.
 */

import { replaceInlineTableForm } from './replace-inline-table-form.js';
import { replaceSectionTableForm } from './replace-section-table-form.js';

/** Escape a dependency key for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite every `version` requirement declared for `depKey` **that also
 * declares a `path`**, in either syntax — inline table
 * (`demo-core = { path = "../core", version = "0.2" }`) or section table
 * (`[dependencies.demo-core]`) — across every table in the manifest.
 */
export function replaceDepVersionReq(source: string, depKey: string, version: string): string {
  const key = escapeRe(depKey);
  return replaceInlineTableForm(replaceSectionTableForm(source, key, version), key, version);
}
