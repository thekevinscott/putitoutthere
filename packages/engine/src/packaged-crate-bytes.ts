import { parseCargoCompressedBytes } from './parse-cargo-compressed-bytes.js';
import { execCapture } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';

/**
 * Compressed size in bytes of the `.crate` `cargo package` would
 * upload, or null when it can't be determined — cargo is absent, cargo
 * rejected the manifest, or its output carried no size line. Null means
 * "can't verify": the check skips rather than inventing a size finding,
 * mirroring the null-means-skip shape `listTrackedFiles` uses outside a
 * git repo.
 */
export async function packagedCrateBytes(cargoTomlPath: string): Promise<number | null> {
  let stderr: string;
  let status: number | null;
  try {
    const r = await execCapture('cargo', [
      'package', '--no-verify', '--allow-dirty', '--manifest-path', cargoTomlPath,
    ]);
    stderr = r.stderr;
    status = 0;
  } catch (err) {
    // cargo absent (ENOENT → status null) or a non-zero exit both mean
    // "can't verify"; skip rather than invent a size finding.
    if (!(err instanceof ExecError)) {return null;}
    stderr = err.stderr;
    status = err.status;
  }
  if (status !== 0) {return null;}
  return parseCargoCompressedBytes(stderr);
}
