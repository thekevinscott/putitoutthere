// Deliberate duplicate of packages/engine/src/utils/sleep.ts (#469) — the ci package is private and the engine does not export internals.
/** `await sleep(ms)` — replaces `execFileSync('sleep', [n])`-style blocking waits. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
