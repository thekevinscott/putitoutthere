export function truncateSummary(md: string): string {
  // GHA job-summary ceiling: 1 MiB per step, 20 MiB total. Cap at 4 MiB to stay well under on a single failure.
  const cap = 4 * 1024 * 1024;
  if (md.length <= cap) {return md;}
  // Keep the head (error + command + versions) — the most useful
  // bytes. Tail bytes are usually repeated noise at this size.
  const note = '\n\n_… truncated. Run `gh run view --log` for the full log._\n';
  return md.slice(0, cap - note.length) + note;
}
