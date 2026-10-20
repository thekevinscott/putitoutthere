const SUMMARY_CAP = 4 * 1024 * 1024; // GHA job-summary ceiling: 1 MiB per step, 20 MiB total. Cap at 4 MiB to stay well under on a single failure.
const TRUNC_NOTE = '\n\n_… truncated. Run `gh run view --log` for the full log._\n';

export function truncateSummary(md: string): string {
  if (md.length <= SUMMARY_CAP) {return md;}
  // Keep the head (error + command + versions) — the most useful
  // bytes. Tail bytes are usually repeated noise at this size.
  const head = md.slice(0, SUMMARY_CAP - TRUNC_NOTE.length);
  return head + TRUNC_NOTE;
}
