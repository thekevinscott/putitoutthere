/**
 * Bound a captured stream to `ceiling` characters, keeping both ends and saying
 * how much went — a stream that just stops is indistinguishable from a tool
 * that fell silent. The banner leads the result rather than sitting at the cut,
 * so it survives the job-summary render's head-only truncation (`verbose.ts`).
 */
export function boundCapture(text: string, ceiling: number): string {
  if (text.length <= ceiling) {
    return text;
  }
  const head = Math.floor(ceiling / 2);
  const tail = ceiling - head;
  return [
    `[putitoutthere] capture ceiling reached: dropped ${text.length - ceiling} bytes`,
    `${text.slice(0, head)}${text.slice(text.length - tail)}`,
  ].join('\n');
}
