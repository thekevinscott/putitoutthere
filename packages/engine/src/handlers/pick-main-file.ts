import { firstFileUnder } from './first-file-under.js';
import type { NpmBuildMode } from './npm-platform.js';

/**
 * The package-relative path `package.json#main` should name for a staged
 * platform artifact. `bundled-cli` resolves through directories to a real
 * file: on the nested `<artifact>/bin/<bin>` layout `readdir`'s first entry is
 * the `bin` **directory**, which #365's chmod then restored at 0644 (#626).
 */
export async function pickMainFile(
  dir: string,
  files: readonly string[],
  mode: NpmBuildMode,
): Promise<string> {
  if (mode === 'napi') {
    const node = files.find((f) => f.endsWith('.node'));
    return node ?? files[0]!;
  }
  // bundled-cli: the first non-package.json entry that resolves to a file,
  // descending into directories. The `files[0]` fallback keeps the
  // defensive shape for a payload-less artifact (an empty one is already
  // rejected upstream) — there is nothing better to name.
  const binary = await firstFileUnder(
    dir,
    files.filter((f) => f !== 'package.json'),
  );
  return binary ?? files[0]!;
}
