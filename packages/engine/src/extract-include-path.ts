export function extractIncludePath(entry: unknown): string | undefined {
  if (typeof entry === 'string') {return entry;}
  if (typeof entry === 'object' && entry !== null) {
    const path = (entry as { path?: unknown }).path;
    if (typeof path === 'string') {return path;}
  }
  return undefined;
}
