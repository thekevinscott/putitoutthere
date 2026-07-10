/**
 * The wheel-relative directory the bundle_cli binary is expected at (#451).
 *
 * The engine analogue of the bash
 *   `stage_suffix="${STAGE_TO#./}"`
 *   `if [ -n "$python_source" ]; then stripped="${stage_suffix#"$python_source"/}"; … fi`
 * — drop a single leading `./` from `stage_to`, then, when a non-empty
 * `python-source` is an exact leading path segment, subtract it (maturin
 * strips that dir from the wheel layout). A `python-source` that is set but
 * is *not* a prefix of `stage_to` leaves the suffix unchanged — that
 * combination is the consumer's misconfiguration to surface, not this
 * function's to paper over, matching the bash's `!=` guard.
 */

export function computeStageSuffix(stageTo: string, pythonSource: string): string {
  const stageSuffix = stageTo.replace(/^\.\//, '');
  if (pythonSource === '') {
    return stageSuffix;
  }
  const prefix = `${pythonSource}/`;
  return stageSuffix.startsWith(prefix) ? stageSuffix.slice(prefix.length) : stageSuffix;
}
