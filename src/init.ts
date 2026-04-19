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
 * - Existing workflow → rename to `.bak` before writing.
 * - Existing `CLAUDE.md` already containing the import line → skip the append.
 *
 * Issue #20 / #25. Plan: §9, §17.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AGENTS_MD, CHECK_YML, releaseYml, TOML_SKELETON, type Cadence } from './templates.js';

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
  skipped: string[];
  backedUp: string[];
}

export function init(opts: InitOptions): InitResult {
  const cwd = opts.cwd;
  const force = Boolean(opts.force);
  const agent = opts.agent ?? 'claude';
  const cadence: Cadence = opts.cadence ?? 'immediate';
  const result: InitResult = { wrote: [], skipped: [], backedUp: [] };

  // 1. putitoutthere.toml
  const tomlPath = join(cwd, 'putitoutthere.toml');
  if (existsSync(tomlPath) && !force) {
    result.skipped.push('putitoutthere.toml');
  } else {
    writeAtomic(tomlPath, TOML_SKELETON);
    result.wrote.push('putitoutthere.toml');
  }

  // 2. putitoutthere/AGENTS.md
  const agentsPath = join(cwd, 'putitoutthere', 'AGENTS.md');
  if (existsSync(agentsPath)) {
    result.skipped.push('putitoutthere/AGENTS.md');
  } else {
    writeAtomic(agentsPath, AGENTS_MD);
    result.wrote.push('putitoutthere/AGENTS.md');
  }

  // 3. CLAUDE.md / .cursorrules
  if (agent === 'claude') {
    const claudePath = join(cwd, 'CLAUDE.md');
    const importLine = '@putitoutthere/AGENTS.md';
    const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : '';
    if (existing.includes(importLine)) {
      result.skipped.push('CLAUDE.md');
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
      result.skipped.push('.cursorrules');
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
  if (existsSync(target)) {
    const bak = `${target}.bak`;
    renameSync(target, bak);
    result.backedUp.push(`.github/workflows/${name}`);
  }
  writeAtomic(target, contents);
  result.wrote.push(`.github/workflows/${name}`);
}

function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}
