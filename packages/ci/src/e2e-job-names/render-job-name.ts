/**
 * Renders a job `name:` template against one matrix row the way GitHub
 * Actions does at dispatch — restricted to bare `${{ matrix.<path> }}`
 * interpolations (#655).
 *
 * The restriction is the whole point. A check name is predictable before the
 * run only when every slot is a plain matrix lookup, because that is all
 * willfire — the tool that predicts a PR's check set — substitutes. Two
 * measured failures from #660:
 *
 *  - `${{ matrix.build && format(' {0}', matrix.build) || '' }}` renders fine
 *    on GitHub, but willfire path-looks-up the literal body, misses, and
 *    marks the whole name unresolved.
 *  - `${{ inputs.fixture }}` is opaque for a different reason: a caller's
 *    matrix does not propagate into a called workflow's `inputs` context, so
 *    naming a reusable workflow's job after it turned 15 resolvable checks
 *    into 15 unresolvable ones.
 *
 * So anything that is not a bare `matrix.<path>` throws here rather than
 * rendering, as does a path that resolves to something other than a JSON
 * scalar. An absent field renders as the empty string, matching GitHub.
 */

export function renderJobName(template: string, row: Readonly<Record<string, unknown>>): string {
  // Function-scoped: a module-level regex initializer evaluates before a
  // mutation mutant activates, and the mutant then false-survives.
  const INTERPOLATION = /\$\{\{(.*?)\}\}/g;
  const BARE_MATRIX_PATH = /^matrix\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;
  return template.replace(INTERPOLATION, (whole: string, body: string): string => {
    const reference = BARE_MATRIX_PATH.exec(body.trim());
    if (reference === null) {
      throw new Error(
        `renderJobName: ${whole} is not a bare \`matrix.<path>\` reference, so no check-name predictor can resolve it`,
      );
    }
    const value = reference[1]!.split('.').reduce<unknown>(
      (current, key) =>
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[key]
          : undefined,
      row,
    );
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    throw new Error(
      `renderJobName: ${whole} resolves to a ${typeof value}, not a JSON scalar, so what it renders is not predictable`,
    );
  });
}
