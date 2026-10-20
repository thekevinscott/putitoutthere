export function isRateLimited(stderr: string | undefined): boolean {
  if (!stderr) {return false;}
  return /status\s+429\b/i.test(stderr) || /429\s+Too\s+Many\s+Requests/i.test(stderr);
}
