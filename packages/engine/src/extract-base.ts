export function extractBase(npmName: string): string {
  const m = /^@([^/]+)\/(.+)$/.exec(npmName);
  return m ? m[2]! : npmName;
}
