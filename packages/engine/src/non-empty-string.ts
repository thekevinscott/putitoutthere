export function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
