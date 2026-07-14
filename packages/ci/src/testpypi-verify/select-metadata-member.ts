/**
 * Decision core for choosing the wheel's `METADATA` member, reproducing the
 * bash's `metadata_paths = [n for n in wheel.namelist() if
 * n.endswith(".dist-info/METADATA")]; if len(metadata_paths) != 1: <error>`.
 * Requires exactly one match; otherwise returns the error line
 * `expected one METADATA file in {wheelName}, found {metadata_paths}`. Pure.
 */

import type { MemberSelection } from './member-selection-types.js';
import { pyStrList } from './py-str-list.js';

export function selectMetadataMember(entryNames: readonly string[], wheelName: string): MemberSelection {
  const matches = entryNames.filter((name) => name.endsWith('.dist-info/METADATA'));
  const [member, ...rest] = matches;
  if (member === undefined || rest.length > 0) {
    return { errorLine: `expected one METADATA file in ${wheelName}, found ${pyStrList(matches)}` };
  }
  return { member };
}
