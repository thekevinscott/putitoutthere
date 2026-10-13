/**
 * Return the inherited workspace value when the field is declared as
 * `<field>.workspace = true`; otherwise pass the raw value through.
 * `wsPkgTable` is `undefined` when no parent `Cargo.toml` declares a
 * `[workspace.package]` block — inheritance simply yields `undefined`
 * there, which `nonEmptyString` correctly treats as missing.
 */
export function resolveInherited(
  value: unknown,
  wsPkgTable: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).workspace === true
  ) {
    return wsPkgTable?.[key];
  }
  return value;
}
