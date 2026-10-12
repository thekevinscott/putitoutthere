/**
 * Verbose-on-failure dump (#15, plan.md §22.4). When a handler throws, writes a
 * diagnostic record to `$GITHUB_STEP_SUMMARY` (markdown) and the structured log
 * stream (one error record), both through the logger's redactor so env-matched
 * secrets never leak. Auto-emitted on failure; never on success.
 */

import { appendFile } from 'node:fs/promises';
import { emitGhaAnnotation } from './emit-gha-annotation.js';
import { redact } from './redact.js';
import { renderMarkdown } from './render-markdown.js';
import type { EnvSource } from './scan-source.js';
import type { Logger } from './types.js';
import type { FailureContext } from './verbose-types.js';

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

export async function dumpFailure(
  err: Error,
  ctx: FailureContext,
  opts: DumpOptions,
): Promise<void> {
  // Default redact() already scans process.env. When callers supply
  // additional envSources (ctx.env from publish.ts, or a per-handler
  // env layer), prepend process.env so both get scanned and the cache
  // keys stay stable. #195.
  const sources =
    opts.envSources !== undefined && opts.envSources.length > 0
      ? [process.env, ...opts.envSources]
      : undefined;
  const md = redact(renderMarkdown(err, ctx), sources);
  await writeSummary(truncate(md));

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

function truncate(md: string): string {
  if (md.length <= SUMMARY_CAP) {return md;}
  // Keep the head (error + command + versions) — the most useful
  // bytes. Tail bytes are usually repeated noise at this size.
  const head = md.slice(0, SUMMARY_CAP - TRUNC_NOTE.length);
  return head + TRUNC_NOTE;
}

async function writeSummary(md: string): Promise<void> {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {return;} // local runs / non-GHA CI — summary is a no-op
  await appendFile(path, md, 'utf8');
}
