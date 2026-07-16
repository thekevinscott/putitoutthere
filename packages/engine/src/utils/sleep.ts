/** `await sleep(ms)` — replaces `execFileSync('sleep', [n])`-style blocking waits. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
