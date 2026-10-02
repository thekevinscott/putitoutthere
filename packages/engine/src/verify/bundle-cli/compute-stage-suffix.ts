/**
 * The wheel-relative directory the bundle_cli binary is expected at (#451):
 * drop a single leading `./` from `stage_to`, then subtract a non-empty
 * `python-source` when it is an exact leading segment (maturin strips that dir
 * from the wheel layout). A non-prefix `python-source` leaves it unchanged.
 */

export function computeStageSuffix(stageTo: string, pythonSource: string): string {
  const stageSuffix = stageTo.replace(/^\.\//, '');
  if (pythonSource === '') {
    return stageSuffix;
  }
  const prefix = `${pythonSource}/`;
  return stageSuffix.startsWith(prefix) ? stageSuffix.slice(prefix.length) : stageSuffix;
}
