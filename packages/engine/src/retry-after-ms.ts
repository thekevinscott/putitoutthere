import { extractProp } from './extract-prop.js';

export function retryAfterMs(err: unknown): number {
  const ra = extractProp(err, 'retryAfter');
  if (typeof ra === 'number' && ra > 0) {return ra * 1000;}
  return 0;
}
