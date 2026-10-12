export function hasNonEmptyRepository(value: unknown): boolean {
  if (typeof value === 'string') {return value.trim().length > 0;}
  if (value !== null && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    return typeof url === 'string' && url.trim().length > 0;
  }
  return false;
}
