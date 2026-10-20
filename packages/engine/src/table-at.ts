import { isTable } from './is-table.js';

/** Walk a dotted table path, returning the nested table or null. */
export function tableAt(
  root: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null {
  let cur: unknown = root;
  for (const key of path) {
    if (!isTable(cur)) {return null;}
    cur = cur[key];
  }
  return isTable(cur) ? cur : null;
}
