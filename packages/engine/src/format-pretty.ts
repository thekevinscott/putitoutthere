import { formatScalar } from './format-scalar.js';

export function formatPretty(record: Record<string, unknown>): string {
  const { level, time: _t, msg, ...fields } = record;
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${formatScalar(v)}`)
    .join(' ');
  const prefix = `[${String(level).toUpperCase()}]`;
  return pairs.length > 0 ? `${prefix} ${String(msg)}  ${pairs}\n` : `${prefix} ${String(msg)}\n`;
}
