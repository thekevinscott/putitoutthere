/**
 * Action manifest invariants. Catches the unbalanced-quote class of bug
 * (#249) where `action.yml` ships syntactically broken and the GitHub
 * runner is the first parser to touch it.
 *
 * Companion to `workflow-yaml-invariants.test.ts`, which only walks
 * `.github/workflows/`. The repo-root `action.yml` had no local parser
 * coverage before this test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const manifestPath = join(repoRoot, 'action.yml');
const manifestText = readFileSync(manifestPath, 'utf8');

describe('#249 action.yml manifest invariants', () => {
  it('parses as YAML', () => {
    expect(() => parse(manifestText)).not.toThrow();
  });

  it('declares the runs entrypoint the GitHub runner needs', () => {
    const m = parse(manifestText) as {
      runs?: { using?: string; main?: string };
    };
    expect(m.runs?.using).toMatch(/^node\d+$/);
    expect(m.runs?.main).toBe('dist-action/index.js');
  });

  it('every input/output description is itself a parseable string', () => {
    const m = parse(manifestText) as {
      inputs?: Record<string, { description?: unknown }>;
      outputs?: Record<string, { description?: unknown }>;
    };
    const fields: Array<[string, unknown]> = [
      ...Object.entries(m.inputs ?? {}).map(
        ([k, v]) => [`inputs.${k}.description`, v.description] as [string, unknown],
      ),
      ...Object.entries(m.outputs ?? {}).map(
        ([k, v]) => [`outputs.${k}.description`, v.description] as [string, unknown],
      ),
    ];
    expect(fields.length).toBeGreaterThan(0);
    for (const [path, value] of fields) {
      expect(typeof value, `${path} must be a string`).toBe('string');
    }
  });
});
