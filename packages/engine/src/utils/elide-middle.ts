/**
 * Bound a captured stream by dropping its middle, keeping both ends.
 *
 * GitHub Actions cuts a log line at 64KB — in the live view and in the
 * downloaded log archive alike — and the half it keeps is the head. A tool
 * that narrates its work before it fails therefore loses exactly the part a
 * reader needs, because the error comes last: `cargo publish --verbose`
 * under `CARGO_TERM_VERBOSE=true` runs to hundreds of KB on a cold verify
 * build, so on #651's release run the whole diagnostic a consumer got was
 * 64KB of *successful* build output that stops mid-compile.
 *
 * Both ends earn their place, so the middle is what goes. The head names
 * the phase that was running; the tail carries the error. Between them sits
 * a count of the dropped bytes, so a reader can tell an elision from a
 * stream that simply stopped.
 *
 * This bounds what gets *rendered into a message*, not what gets captured:
 * predicates that scan a tool's stderr (the 429-fallback trigger, the
 * first-publish TP rejection) still read it whole, and the job-summary dump
 * — a file, with no per-line cut — still carries it whole.
 */

export interface ElideMiddleOptions {
  // `| undefined` is explicit so call sites can forward an optional field
  // directly under exactOptionalPropertyTypes.
  head?: number | undefined;
  tail?: number | undefined;
}

export function elideMiddle(text: string, opts: ElideMiddleOptions = {}): string {
  // Defaults live here, not in module constants: a top-level `const` is
  // evaluated at import time, which puts it out of reach of the mutation
  // gate's per-test switching and lets a wrong budget survive unkilled.
  const head = opts.head ?? 4 * 1024;
  const tail = opts.tail ?? 16 * 1024;
  const dropped = text.length - head - tail;
  if (dropped <= 0) {return text;}
  return [
    text.slice(0, head),
    `[... ${dropped} bytes elided ...]`,
    text.slice(text.length - tail),
  ].join('\n\n');
}
