import { extractProp } from './extract-prop.js';

export function retryAfterMs(err: unknown): number {
  const ra = extractProp(err, 'retryAfter');
  return typeof ra === 'number' ? Math.max(0, ra) * 1000 : 0;
}
