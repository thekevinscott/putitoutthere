/**
 * Decision core for choosing the sdist's `PKG-INFO` member, reproducing the
 * bash's `pkg_info_paths = [m for m in sdist.getmembers() if
 * m.name.endswith("/PKG-INFO")]; if not pkg_info_paths: <error>` — the first
 * matching member wins, and an empty match returns the error line
 * `no PKG-INFO file in {sdistName}`. Pure.
 */

import type { MemberSelection } from './member-selection-types.js';

export function selectPkgInfoMember(entryNames: readonly string[], sdistName: string): MemberSelection {
  const [member] = entryNames.filter((name) => name.endsWith('/PKG-INFO'));
  if (member === undefined) {
    return { errorLine: `no PKG-INFO file in ${sdistName}` };
  }
  return { member };
}
