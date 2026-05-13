#!/usr/bin/env node
// Patch-coverage gate. Runs after `pnpm test:unit:coverage` has produced
// `coverage/coverage-final.json` (istanbul-format per-file data emitted
// by vitest's v8 reporter).
//
// For every line ADDED by this PR's diff in `src/**/*.ts` (excluding
// *.test.ts files), assert that the line is covered by the unit suite.
// Two failure modes, both fatal:
//
//   1. An added line has zero statement hits in the coverage data
//      (uncovered new code).
//   2. An added line contains an `/* v8 ignore */` marker (escape hatch
//      introduction; "strict 100% — no escape hatches").
//
// Existing markers in unchanged code are grandfathered. Modifying a
// region under a grandfathered marker counts as new introduction —
// touch the line, you own its coverage.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.BASE_SHA;
const HEAD = process.env.HEAD_SHA;
if (!BASE || !HEAD) {
  console.error('::error::patch-coverage: BASE_SHA and HEAD_SHA must be set');
  process.exit(2);
}

// Make sure both SHAs are reachable. Actions/checkout@v6 with fetch-depth: 0
// gives a full clone, so this is just a defensive sanity check.
try {
  execFileSync('git', ['cat-file', '-e', BASE], { stdio: 'ignore' });
  execFileSync('git', ['cat-file', '-e', HEAD], { stdio: 'ignore' });
} catch {
  console.error(`::error::patch-coverage: ${BASE} or ${HEAD} not reachable in this clone`);
  process.exit(2);
}

const diffOut = execFileSync(
  'git',
  ['diff', '--unified=0', '--no-prefix', `${BASE}..${HEAD}`, '--', 'src/'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

// Parse unified diff. We need:
//   - the file path under +++ (post-image)
//   - for every @@ hunk, the post-image starting line + length
//   - every `+` line (added) inside that hunk, with its absolute line number
const addedByFile = new Map(); // path -> [{line, text}]
{
  let currentFile = null;
  let nextLine = 0;
  for (const raw of diffOut.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      // `git diff --no-prefix` for new files emits `+++ /dev/null` on delete,
      // or `+++ path` on add/modify.
      currentFile = p === '/dev/null' ? null : p;
      continue;
    }
    if (raw.startsWith('@@ ')) {
      // @@ -A,B +C,D @@ ...
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (m) nextLine = parseInt(m[1], 10);
      continue;
    }
    if (currentFile === null) continue;
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      // ignore *.test.ts and *.d.ts (consistent with vitest exclude list)
      if (/\.test\.ts$|\.d\.ts$/.test(currentFile)) {
        nextLine++;
        continue;
      }
      if (!currentFile.startsWith('src/') || !currentFile.endsWith('.ts')) {
        nextLine++;
        continue;
      }
      const text = raw.slice(1);
      const list = addedByFile.get(currentFile) ?? [];
      list.push({ line: nextLine, text });
      addedByFile.set(currentFile, list);
      nextLine++;
    } else if (raw.startsWith(' ')) {
      nextLine++;
    }
    // `-` lines: skipped — only count post-image rows
  }
}

if (addedByFile.size === 0) {
  console.log('patch-coverage: no src/**/*.ts additions in this PR; passing.');
  process.exit(0);
}

// Load coverage data. The v8 reporter writes istanbul format keyed by
// absolute path.
const covPath = resolve('coverage/coverage-final.json');
let cov;
try {
  cov = JSON.parse(readFileSync(covPath, 'utf8'));
} catch (err) {
  console.error(`::error::patch-coverage: cannot read ${covPath}: ${err.message}`);
  process.exit(2);
}

// Build a lookup: for each repo-relative src path, return the set of
// line numbers with at least one covered statement.
function coveredLines(relPath) {
  const abs = resolve(relPath);
  const data = cov[abs];
  if (!data) return null;
  const covered = new Set();
  const uncovered = new Set();
  for (const [id, hits] of Object.entries(data.s)) {
    const loc = data.statementMap[id];
    if (!loc) continue;
    const from = loc.start.line;
    const to = loc.end.line;
    for (let l = from; l <= to; l++) {
      if (hits > 0) covered.add(l);
      else uncovered.add(l);
    }
  }
  // A line shared between a covered and uncovered statement counts as
  // covered (the line ran at least once).
  for (const l of covered) uncovered.delete(l);
  return { covered, uncovered };
}

// Detect new escape-hatch markers. Strict 100% means a `/* v8 ignore`
// in ANY added line is rejected outright.
const HATCH_RE = /\/\*\s*(?:v8|c8|istanbul)\s+ignore/i;

let violations = [];
for (const [file, lines] of addedByFile) {
  const cl = coveredLines(file);
  for (const { line, text } of lines) {
    if (HATCH_RE.test(text)) {
      violations.push({
        file,
        line,
        kind: 'escape-hatch',
        msg: `new ignore marker introduced: ${text.trim()}`,
      });
      continue;
    }
    // Blank lines, pure-comment lines, and pure-punctuation lines
    // (`}`, `});`, etc.) have no statements and never get instrumented
    // by v8. Skip them to avoid false positives.
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed === '*/') continue;
    if (/^[(){}\[\];,]+$/.test(trimmed)) continue;
    if (cl === null) {
      // File has no coverage data at all — every added line in it is uncovered.
      violations.push({
        file,
        line,
        kind: 'uncovered',
        msg: `file has no coverage data (no test ever loaded it)`,
      });
      continue;
    }
    if (!cl.covered.has(line) && cl.uncovered.has(line)) {
      violations.push({
        file,
        line,
        kind: 'uncovered',
        msg: `added line not exercised by unit tests: ${trimmed}`,
      });
    }
  }
}

if (violations.length === 0) {
  console.log('patch-coverage: every added src/ line is covered, no escape hatches. ✓');
  process.exit(0);
}

console.error('patch-coverage: violations found.');
console.error('');
console.error('Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.');
console.error('Add a unit test that exercises each new line listed below, or restructure');
console.error('the new code so it sits on an already-tested path.');
console.error('');
for (const v of violations) {
  console.error(`::error file=${v.file},line=${v.line}::patch-coverage [${v.kind}] ${v.msg}`);
}
console.error('');
console.error(`${violations.length} violation(s).`);
process.exit(1);
