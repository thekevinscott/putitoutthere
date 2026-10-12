import type { FailureContext } from './verbose-types.js';

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
export function emitGhaAnnotation(
  err: Error,
  ctx: FailureContext,
  redactedMsg: string,
): void {
  if (process.env.GITHUB_ACTIONS !== 'true') {return;}
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
