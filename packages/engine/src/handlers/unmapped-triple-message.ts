export function unmappedTripleMessage(target: string): string {
  return `Target triple "${target}" is not mapped to npm os/cpu. Add it to TRIPLE_MAP in src/handlers/npm-platform.ts.`;
}
