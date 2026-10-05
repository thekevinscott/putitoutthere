/**
 * Bound a captured stream by dropping its middle, keeping both ends. GitHub
 * Actions cuts a log line at 64KB — live view and archive alike — and keeps the
 * *head*, so a tool that narrates before failing loses its error (#651). Only
 * rendered messages are bounded; predicates and the dump file read it whole.
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
