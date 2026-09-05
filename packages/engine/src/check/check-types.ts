export interface CheckFinding {
  /** The `[[package]].name` the finding is scoped to. Absent for
   *  file-level findings (missing config, root-level parse errors). */
  package?: string;
  /** Single-line, actionable message: failing artefact path or
   *  field, why it matters, what to change. */
  message: string;
}
