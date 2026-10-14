export function extractIncludePath(entry: unknown): string | undefined {
  if (typeof entry === 'string') {return entry;}
  const path = (entry as { path?: unknown } | null | undefined)?.path;
  return typeof path === 'string' ? path : undefined;
}
