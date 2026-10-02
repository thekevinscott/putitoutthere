/**
 * Whether a coverage ignore marker carries a documented reason — the
 * `-- <reason>` suffix v8/c8 accept. Only meaningful for text `isEscapeHatch`
 * already matched. Fixed-string parsing, not regex, so the mutation gate has no
 * quantifier survivors; re-joining on `--` preserves a reason containing `--`.
 */
export function hasIgnoreReason(text: string): boolean {
  const afterDash = text.split('--').slice(1).join('--');
  const reason = afterDash.split('*/')[0]!;
  return reason.trim().length > 0;
}
