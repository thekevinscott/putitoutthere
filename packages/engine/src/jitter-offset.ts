/** ±`fraction` of the base delay. */
export function jitterOffset(baseDelay: number, fraction: number): number {
  return (Math.random() * 2 - 1) * baseDelay * fraction;
}
