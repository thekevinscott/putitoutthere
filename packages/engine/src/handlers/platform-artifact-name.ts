import { sanitizeArtifactName } from '../config.js';
import type { NpmBuildMode } from './npm-platform.js';

/**
 * Plan-time + handler-time: compute the artifact directory name for a
 * given (package, mode, triple). The mode infix is only added when
 * the package has multiple build entries, so single-mode packages keep
 * their historical `<safe>-<triple>` artifact layout byte-for-byte.
 */
export function platformArtifactName(
  pkgName: string,
  mode: NpmBuildMode,
  triple: string,
  isMulti: boolean,
): string {
  const safe = sanitizeArtifactName(pkgName);
  return isMulti ? `${safe}-${mode}-${triple}` : `${safe}-${triple}`;
}
