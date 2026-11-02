export function extractScope(npmName: string): string {
  const m = /^@([^/]+)\/(.+)$/.exec(npmName);
  return m ? m[1]! : '';
}
