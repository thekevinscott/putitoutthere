export function formatScalar(v: unknown): string {
  if (typeof v === 'string') {return v;}
  if (typeof v === 'number') {return String(v);}
  return JSON.stringify(v);
}
