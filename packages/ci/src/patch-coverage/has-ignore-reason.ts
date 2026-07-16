/**
 * Whether a coverage ignore marker carries a documented reason — the
 * `-- <reason>` suffix that v8/c8 accept after the ignore directive. The
 * patch-coverage gate permits a reasoned marker but still rejects a bare one,
 * so a newly-added marker must justify itself.
 *
 * Only meaningful for text `isEscapeHatch` already matched. Fixed-string
 * parsing (split, not regex) so the mutation gate has no quantifier survivors:
 * split on the `--` reason separator and keep everything after the first one
 * (re-joining with `--` preserves a reason that itself contains `--`), cut that
 * at the block-comment close, and report whether a non-whitespace reason
 * remains. Pure.
 */
export function hasIgnoreReason(text: string): boolean {
  const afterDash = text.split('--').slice(1).join('--');
  const reason = afterDash.split('*/')[0]!;
  return reason.trim().length > 0;
}
