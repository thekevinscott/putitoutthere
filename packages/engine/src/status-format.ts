/**
 * Single-line, monospace-friendly render of one status row, used by the
 * CLI's non-`--json` output.
 *
 * Issue #403.
 */

import type { StatusRow } from './status-types.js';

export function formatStatusRow(row: StatusRow): string {
  const tagCol = row.tagVersion ?? '—';
  const registryCol = row.registryUnreachable ? 'unreachable' : (row.registry ?? '—');
  let mark = '✓';
  if (row.registryUnreachable) {mark = '?';}
  if (row.drift) {mark = '⚠';}
  return `${row.package}  tag=${tagCol}  registry=${registryCol}  ${mark} ${row.state}`;
}
