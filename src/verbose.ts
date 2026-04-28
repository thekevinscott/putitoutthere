/**
 * Verbose-on-failure dump.
 *
 * When a handler throws, this writes a rich diagnostic record to
 * `$GITHUB_STEP_SUMMARY` (as markdown) and to the structured log
 * stream (as a single error-level record). Both are passed through
 * the logger's redactor so env-matched secrets never leak.
 *
 * Per plan.md §22.4. Auto-emitted on failure; never on success.
 *
 * Issue #15.
 */

import { appendFileSync } from 'node:fs';
import { redact, type EnvSource } from './log.js';
import type { Logger } from './types.js';

/**
 * Everything the dump needs to describe the failure. Handlers build
 * this from their own state (the command they ran, the subprocess
 * output they captured, handler-specific extras like parsed wheel
 * tags). Nothing in here is putitoutthere-specific -- a fresh handler
 * can populate all fields from scratch.
 */
export interface FailureContext {
  /** Internal package name from pilot.toml. */
  package: string;
  /** Handler kind (crates | pypi | npm). */
  handler: string;
  /** The command that failed, argv-style. env values are redacted at emit. */
  command: readonly string[];
  /** stdout captured from the failing command. */
  stdout: string;
  /** stderr captured from the failing command. */
  stderr: string;
  /** Exit code (for child processes) or -1 when N/A. */
  exitCode: number;
  /** `{tool: "tool --version output"}`. Optional; handlers supply what's relevant. */
  toolVersions?: Record<string, string>;
  /**
   * Handler-specific diagnostic extras. Arbitrary key/value; rendered
   * verbatim in the summary. Examples from the plan: wheel platform
   * tags, npm tarball contents, cargo package --list output.
   */
  extras?: Record<string, unknown>;
}

export interface DumpOptions {
  log: Logger;
  /**
   * Additional env-like objects to scan for secrets when redacting the
   * rendered markdown summary. `process.env` is always scanned. Pass
   * `ctx.env` here when the caller's ctx might carry credentials that
   * never touched `process.env` (handler-layered OIDC-minted tokens,
   * test-supplied env maps, etc.) — otherwise the job-summary markdown
   * could leak what the structured log line (which goes through the
   * same logger's own envSources) would have redacted. See #195.
   */
  envSources?: readonly EnvSource[];
}

const SUMMARY_CAP = 4 * 1024 * 1024; // GHA job-summary ceiling: 1 MiB per step, 20 MiB total. Cap at 4 MiB to stay well under on a single failure.
const TRUNC_NOTE = '\n\n_… truncated. Run `gh run view --log` for the full log._\n';

export function dumpFailure(
  err: Error,
  ctx: FailureContext,
  opts: DumpOptions,
): void {
  // Default redact() already scans process.env. When callers supply
  // additional envSources (ctx.env from publish.ts, or a per-handler
  // env layer), prepend process.env so both get scanned and the cache
  // keys stay stable. #195.
  const sources =
    opts.envSources !== undefined && opts.envSources.length > 0
      ? [process.env, ...opts.envSources]
      : undefined;
  const md = redact(renderMarkdown(err, ctx), sources);
  writeSummary(truncate(md));

  // Phase 3 / Idea 6. The markdown summary above is auth-gated on
  // private repos and not always reachable to a foreign agent helping
  // debug from outside; a workflow-command annotation written to
  // stdout renders on the public run-summary page where any observer
  // (including WebFetch) can read it. Carry the same redaction the
  // markdown gets.
  emitGhaAnnotation(err, ctx, redact(err.message, sources));

  // A single structured record pairs the summary so downstream log
  // pipelines (JSON sinks, GHA log grep) can find the failure by
  // package + handler + exitCode without parsing markdown.
  opts.log.error(`${ctx.handler}/${ctx.package} failed: ${err.message}`, {
    package: ctx.package,
    handler: ctx.handler,
    exitCode: ctx.exitCode,
    command: ctx.command.join(' '),
  });
}

/**
 * Emit a GitHub Actions `::error::` workflow command on stdout.
 * Visible on the run-summary page's annotation strip — the only
 * failure surface reachable without GitHub auth.
 *
 * No-op outside GHA (gated on `GITHUB_ACTIONS=true`, the canonical
 * runner env var). Stays one line: GH annotations are line-oriented
 * and a bare embedded newline truncates the body.
 */
const ANNOTATION_MAX_LEN = 500;
function emitGhaAnnotation(
  err: Error,
  ctx: FailureContext,
  redactedMsg: string,
): void {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  void err; // arity preserved for future callers; redactedMsg drives output
  const codeMatch = /\[(PIOT_[A-Z0-9_]+)\]/.exec(redactedMsg);
  const codeTag = codeMatch ? ` [${codeMatch[1]}]` : '';
  // First non-empty line. The full diagnostic lives in the markdown
  // summary and the structured log record; the annotation is the
  // public one-liner.
  const firstLine =
    redactedMsg
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? '';
  const head = `${ctx.handler}/${ctx.package}${codeTag}: ${firstLine}`;
  const trimmed =
    head.length > ANNOTATION_MAX_LEN
      ? head.slice(0, ANNOTATION_MAX_LEN - 1) + '…'
      : head;
  // Strip any embedded line breaks that survived (defensive — first-line
  // selection should have prevented them) so the annotation stays a
  // single workflow command.
  const oneLine = trimmed.replace(/[\r\n]+/g, ' ');
  process.stdout.write(`::error::${oneLine}\n`);
}

function renderMarkdown(err: Error, ctx: FailureContext): string {
  const lines: string[] = [];
  lines.push(`## ❌ ${ctx.handler}/${ctx.package} failed`);
  lines.push('');
  lines.push(`**Error.** ${err.message}`);
  lines.push(`**Exit code.** \`${ctx.exitCode}\``);
  lines.push('');
  lines.push('**Command**');
  lines.push('```');
  lines.push(ctx.command.join(' '));
  lines.push('```');

  if (ctx.toolVersions && Object.keys(ctx.toolVersions).length > 0) {
    lines.push('');
    lines.push('**Tool versions**');
    lines.push('```');
    for (const [k, v] of Object.entries(ctx.toolVersions)) {
      lines.push(`${k}: ${v}`);
    }
    lines.push('```');
  }

  lines.push('');
  lines.push('**stdout**');
  lines.push('```');
  lines.push(ctx.stdout || '(empty)');
  lines.push('```');

  lines.push('');
  lines.push('**stderr**');
  lines.push('```');
  lines.push(ctx.stderr || '(empty)');
  lines.push('```');

  if (ctx.extras && Object.keys(ctx.extras).length > 0) {
    lines.push('');
    lines.push('**Handler extras**');
    lines.push('```json');
    lines.push(JSON.stringify(ctx.extras, null, 2));
    lines.push('```');
  }

  lines.push('');
  return lines.join('\n');
}

function truncate(md: string): string {
  if (md.length <= SUMMARY_CAP) return md;
  // Keep the head (error + command + versions) — the most useful
  // bytes. Tail bytes are usually repeated noise at this size.
  const head = md.slice(0, SUMMARY_CAP - TRUNC_NOTE.length);
  return head + TRUNC_NOTE;
}

function writeSummary(md: string): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return; // local runs / non-GHA CI — summary is a no-op
  appendFileSync(path, md, 'utf8');
}
