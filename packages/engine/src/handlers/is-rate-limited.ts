export function isRateLimited(stderr: string | undefined): boolean {
  return Boolean(stderr?.match(/status\s+429\b|429\s+Too\s+Many\s+Requests/i));
}
