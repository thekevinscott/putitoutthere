import { isFragment } from '../utils/is-fragment.js';

/**
 * Whether a path sits under a fragment folder but breaks the
 * `YYYY-MM-DD-<slug>.md` naming, so it would silently not count. The folder's
 * own README.md is the one exception.
 */
export function isMalformedFragment(path: string, dir: string): boolean {
  if (!path.startsWith(`${dir}/`)) {
    return false;
  }
  if (path === `${dir}/README.md`) {
    return false;
  }
  return !isFragment(path, dir);
}
