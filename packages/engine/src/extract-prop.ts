export function extractProp(err: unknown, key: string): unknown {
  if (err && typeof err === 'object' && key in err) {
    return (err as Record<string, unknown>)[key];
  }
  return undefined;
}
