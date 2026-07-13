/**
 * The per-iteration progress line the poll loop logs while cited runs are
 * still in flight, matching the bash template exactly.
 */
export function pollPendingMessage(elapsedSeconds: number, pendingCitations: readonly string[]): string {
  return (
    `evidence-check: t+${elapsedSeconds}s — ${pendingCitations.length} citation(s) ` +
    `still pending (no matching workflow_run yet, or matches still in_progress / queued): ` +
    `${pendingCitations.join(', ')}`
  );
}
