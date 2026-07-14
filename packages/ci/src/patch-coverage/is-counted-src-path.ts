/**
 * Whether the patch-coverage gate (#468) counts added lines in this
 * post-image path. Reproduces the `.mjs`'s two skip filters as fixed-string
 * `endsWith`/`startsWith` checks (no regex, so no quantifier equivalent
 * mutants): test and declaration files never count, and only engine
 * `packages/engine/src/**` TypeScript counts. Pure.
 */

export function isCountedSrcPath(file: string): boolean {
  if (file.endsWith('.test.ts')) {
    return false;
  }
  if (file.endsWith('.d.ts')) {
    return false;
  }
  if (!file.startsWith('packages/engine/src/')) {
    return false;
  }
  return file.endsWith('.ts');
}
