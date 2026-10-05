/**
 * Lists the `${{ matrix.<path> }}` slots of a job `name:` template that one
 * matrix row cannot supply a value for (#655).
 *
 * This is deliberately *not* `renderJobName`'s absent-field rule, and the two
 * must not be unified. They model different engines:
 *
 *  - GitHub renders an absent matrix field as the empty string, so the job
 *    still dispatches and the check name is merely ugly. `renderJobName`
 *    copies that, because its job is to predict the string GitHub will show.
 *  - willfire — the tool that predicts a PR's check set, and the reason #655
 *    exists — substitutes a bare `matrix.<path>` only when the row actually
 *    carries that path. When it misses, the interpolation survives verbatim
 *    into the name, which willfire then reports as *unresolvable* and drops
 *    from the predicted set entirely.
 *
 * Measured: adding a `${{ matrix.python_version }}` slot to the e2e `build`
 * job's name took 53 of its 84 rows from resolvable to unresolvable in one
 * commit, because `python_version` is absent on every `npm` and `crates` row.
 * Nothing about that is visible on GitHub — the names render, the jobs run —
 * so a reviewer reading the `name:` diff sees an improvement. Losing a
 * prediction is strictly worse than an ugly name: `CI Gate` aggregates what it
 * can predict, and a name no predictor can match can never go in a ruleset.
 *
 * Hence the rule this function enforces: a `name:` template may read only
 * fields present on *every* row the job will dispatch for. Optional
 * `MatrixRow` fields are off limits, however stable they are.
 */

export function unresolvableSlots(
  template: string,
  row: Readonly<Record<string, unknown>>,
): string[] {
  // Function-scoped: a module-level regex initializer evaluates before a
  // mutation mutant activates, and the mutant then false-survives.
  const INTERPOLATION = /\$\{\{(.*?)\}\}/g;
  const BARE_MATRIX_PATH = /^matrix\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;
  const missing: string[] = [];
  for (const match of template.matchAll(INTERPOLATION)) {
    const whole = match[0];
    const reference = BARE_MATRIX_PATH.exec(match[1]!.trim());
    if (reference === null) {
      // Not a matrix lookup at all, so willfire cannot substitute it either.
      missing.push(whole);
      continue;
    }
    const value = reference[1]!.split('.').reduce<unknown>(
      (current, key) =>
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[key]
          : undefined,
      row,
    );
    if (value === undefined) {
      missing.push(whole);
    }
  }
  return missing;
}
