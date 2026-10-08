import { execCapture } from '../utils/exec-capture.js';
import { compareGlibc } from './compare-glibc.js';
import { maxGlibc } from './max-glibc.js';

export async function checkGnuLinkage(binary: string, shown: string): Promise<boolean> {
  const ceiling = 'GLIBC_2.17';
  let linkage: string;
  try {
    linkage = (await execCapture('file', [binary])).stdout;
  } catch {
    process.stdout.write("::error::required command 'file' not found on this runner — cannot assert linkage\n");
    return false;
  }
  if (/statically linked|static-pie linked/.test(linkage)) {
    process.stdout.write(
      `::error::bundle_cli binary ${shown} is statically linked — a static binary cannot dlopen, so SQLite extension loading fails at runtime (#605, dirsql#762). Expected a dynamically-linked gnu build pinned to ${ceiling} via cargo-zigbuild.\n${linkage}`,
    );
    return false;
  }
  const max = maxGlibc((await execCapture('objdump', ['-T', binary])).stdout);
  if (max !== undefined && compareGlibc(max, ceiling) > 0) {
    process.stdout.write(
      `::error::bundle_cli binary ${shown} requires ${max}, exceeding the ${ceiling} portability floor — it would fail at runtime on distros older than the runner (#381, #605).\n`,
    );
    return false;
  }
  process.stdout.write(`ok bundle_cli: ${shown} is dynamically linked, glibc ceiling ${max ?? 'none'} within ${ceiling}\n`);
  return true;
}
