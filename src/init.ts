/**
 * `putitoutthere init` — scaffold a new repo.
 *
 * Writes:
 * - `putitoutthere.toml` (skeleton with `version = 1`, no packages)
 * - `putitoutthere/AGENTS.md` (trailer convention doc per plan.md §17.3)
 * - `.github/workflows/release.yml` + `.github/workflows/putitoutthere-check.yml`
 * - Appends `@putitoutthere/AGENTS.md` to `CLAUDE.md` (creates if missing)
 *
 * Idempotency (plan.md §17.4):
 * - Existing `putitoutthere.toml` → skip unless `--force`.
 * - Existing workflow → if byte-identical, mark already-present (no .bak);
 *   otherwise rename to `.bak` before writing (#148).
 * - Existing `CLAUDE.md` already containing the import line → skip the append.
 *
 * Issue #20 / #25. Plan: §9, §17.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AGENTS_MD, CHECK_YML, releaseYml, tomlSkeleton, type Cadence } from './templates.js';

export interface InitOptions {
  cwd: string;
  /** Overwrite `putitoutthere.toml` even if it exists. */
  force?: boolean;
  /** Reserved for v0.1. Only `claude` supported today. */
  agent?: 'claude' | 'cursor';
  /** Release cadence; selects which release.yml template to emit. */
  cadence?: Cadence;
}

export interface InitResult {
  wrote: string[];
  /**
   * Files skipped because they already exist and `--force` would
   * overwrite them. Just `putitoutthere.toml` today.
   */
  skipped: string[];
  /**
   * Files already in a correct state (AGENTS.md exists untouched,
   * CLAUDE.md already imports the trailer doc, etc.). `--force`
   * would not change these, so the CLI shouldn't suggest it.
   */
  alreadyPresent: string[];
  backedUp: string[];
  /**
   * Short notes for the CLI to surface to the user — e.g. "detected
   * existing v* tags; suggested tag_format = \"v{version}\" in the
   * skeleton." Not errors; just signal about automatic decisions.
   */
  notes: string[];
}

export function init(opts: InitOptions): InitResult {
  const cwd = opts.cwd;
  const force = Boolean(opts.force);
  const agent = opts.agent ?? 'claude';
  const cadence: Cadence = opts.cadence ?? 'immediate';
  const result: InitResult = {
    wrote: [],
    skipped: [],
    alreadyPresent: [],
    backedUp: [],
    notes: [],
  };

  // 1. putitoutthere.toml  -- `--force`-gated.
  // Detect single-package shape + existing v* tag history so we suggest
  // `tag_format = "v{version}"` instead of leaving the commented-out
  // default — which would fork a parallel {name}-v{version} timeline on
  // repos that already tag as v*. #204.
  const suggestion = detectTagFormatSuggestion(cwd);
  const tomlPath = join(cwd, 'putitoutthere.toml');
  if (existsSync(tomlPath) && !force) {
    result.skipped.push('putitoutthere.toml');
  } else {
    const seeds = suggestion
      ? {
          tag_format: suggestion.tag_format,
          tag_format_reason: `existing v*-style tag history (${suggestion.detectedTags
            .slice(0, 3)
            .join(', ')}${suggestion.detectedTags.length > 3 ? ', …' : ''})`,
        }
      : null;
    writeAtomic(tomlPath, tomlSkeleton(seeds));
    result.wrote.push('putitoutthere.toml');
    if (suggestion !== null) {
      result.notes.push(
        `tag_format: detected existing \`v*\` tags (${suggestion.detectedTags.slice(0, 3).join(', ')}${
          suggestion.detectedTags.length > 3 ? ', …' : ''
        }); suggested \`tag_format = "v{version}"\` in putitoutthere.toml to keep the existing timeline. Edit the file to override.`,
      );
    }
  }

  // 2. putitoutthere/AGENTS.md  -- not `--force`-gated; users edit this.
  const agentsPath = join(cwd, 'putitoutthere', 'AGENTS.md');
  if (existsSync(agentsPath)) {
    result.alreadyPresent.push('putitoutthere/AGENTS.md');
  } else {
    writeAtomic(agentsPath, AGENTS_MD);
    result.wrote.push('putitoutthere/AGENTS.md');
  }

  // 3. CLAUDE.md / .cursorrules  -- append-only; skip if already imported.
  if (agent === 'claude') {
    const claudePath = join(cwd, 'CLAUDE.md');
    const importLine = '@putitoutthere/AGENTS.md';
    const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : '';
    if (existing.includes(importLine)) {
      result.alreadyPresent.push('CLAUDE.md');
    } else {
      const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      writeAtomic(claudePath, `${existing}${sep}${importLine}\n`);
      result.wrote.push('CLAUDE.md');
    }
    /* v8 ignore start -- cursor path is stub-level until requested */
  } else {
    const cursorPath = join(cwd, '.cursorrules');
    const existing = existsSync(cursorPath) ? readFileSync(cursorPath, 'utf8') : '';
    if (existing.includes('Release signaling for Put It Out There')) {
      result.alreadyPresent.push('.cursorrules');
    } else {
      writeAtomic(cursorPath, `${existing}${existing.length > 0 ? '\n' : ''}${AGENTS_MD}`);
      result.wrote.push('.cursorrules');
    }
  }
  /* v8 ignore stop */

  // 4. Workflows
  writeWorkflow(cwd, 'release.yml', releaseYml(cadence), result);
  writeWorkflow(cwd, 'putitoutthere-check.yml', CHECK_YML, result);

  return result;
}

/* ---------------------------- internals ---------------------------- */

function writeWorkflow(cwd: string, name: string, contents: string, result: InitResult): void {
  const target = join(cwd, '.github', 'workflows', name);
  const rel = `.github/workflows/${name}`;
  if (existsSync(target)) {
    // #148: skip the `.bak` dance when the existing file is already
    // byte-identical to what init would write. Otherwise re-running init
    // pollutes the working tree with a fresh .bak each time.
    const existing = readFileSync(target, 'utf8');
    if (existing === contents) {
      result.alreadyPresent.push(rel);
      return;
    }
    const bak = `${target}.bak`;
    renameSync(target, bak);
    result.backedUp.push(rel);
  }
  writeAtomic(target, contents);
  result.wrote.push(rel);
}

function writeAtomic(path: string, contents: string): void {
  // lgtm[js/insecure-temporary-file] -- writes into opts.cwd, which
  // is the user's project root in production; only the test harness
  // passes an os.tmpdir() subpath here, and that's controlled input.
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o644 });
}

/**
 * Shape returned when the repo already carries a `v{X.Y.Z}` tag
 * history. The caller embeds a `tag_format = "v{version}"` line in
 * the emitted TOML skeleton and surfaces a note to the user.
 */
export interface TagFormatSuggestion {
  tag_format: 'v{version}';
  detectedTags: string[];
}

/**
 * Look for strict-semver `v*` tags on the current checkout. When
 * present (and no `<name>-v*` tags are also present), suggest
 * `tag_format = "v{version}"` in the skeleton so the adopter's next
 * release stays on their existing tag timeline instead of starting a
 * parallel `{name}-v{version}` one. #204.
 *
 * Returns null in any of these cases (default `{name}-v{version}` is
 * right):
 * - Not a git repo / `git` not on PATH.
 * - No `v{X.Y.Z}` tags.
 * - `<name>-v*` tags already exist (the repo is polyglot-shaped).
 */
function detectTagFormatSuggestion(cwd: string): TagFormatSuggestion | null {
  let vTags: string[];
  try {
    const out = execFileSync('git', ['tag', '-l', 'v*.*.*'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter((l) => /^v\d+\.\d+\.\d+$/.test(l));
    vTags = out;
  } catch {
    return null;
  }
  if (vTags.length === 0) return null;

  // If any `<name>-v*` tag exists, the repo is polyglot-shaped; don't
  // hijack the default.
  /* v8 ignore start -- defensive: the first git call succeeded above,
   * so this one with a different glob is vanishingly unlikely to fail.
   * Kept as belt-and-braces for unusual filesystems. */
  try {
    const out = execFileSync('git', ['tag', '-l', '*-v*.*.*'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter((l) => /^.+-v\d+\.\d+\.\d+$/.test(l));
    if (out.length > 0) return null;
  } catch {
    /* fall through */
  }
  /* v8 ignore stop */

  return { tag_format: 'v{version}', detectedTags: vTags };
}
