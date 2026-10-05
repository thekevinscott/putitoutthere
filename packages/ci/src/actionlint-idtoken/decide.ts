/**
 * Decision core for the actionlint id-token gate (#452). I/O-free: decides
 * whether a PR-time-path workflow declares `id-token: write`, emitting exactly
 * what the inline bash in `.github/workflows/actionlint.yml` did. Matched with
 * `startsWith`/`trimStart`, not a regex: `[[:space:]]+` breeds equivalent mutants.
 */

export interface WorkflowFile {
  /** The workflow's repo-relative path, echoed in the `::error file=…` line. */
  path: string;
  /** The workflow file's full text. */
  content: string;
}

export interface ActionlintIdTokenInput {
  files: readonly WorkflowFile[];
}

export interface ActionlintIdTokenResult {
  exitCode: number;
  lines: readonly string[];
}

const KEY = 'id-token';
const VALUE = 'write';

export function decideActionlintIdToken(input: ActionlintIdTokenInput): ActionlintIdTokenResult {
  // Reproduces `grep -E '^[[:space:]]+id-token[[:space:]]*:[[:space:]]*write'`
  // on a single line: leading indentation, then the `id-token` key, an
  // optional-space colon, optional space, and a `write` value.
  const grantsIdTokenWrite = (line: string): boolean => {
    const body = line.trimStart();
    if (body === line) {
      return false; // no leading whitespace — the `[[:space:]]+` requirement
    }
    if (!body.startsWith(KEY)) {
      return false;
    }
    const afterKey = body.slice(KEY.length).trimStart();
    if (!afterKey.startsWith(':')) {
      return false;
    }
    return afterKey.slice(1).trimStart().startsWith(VALUE);
  };

  const lines: string[] = [];
  // A boolean, not a counter: the exit code only cares about zero-vs-nonzero,
  // and a counter's `+= 1` → `-= 1` mutation is equivalent under that reduction
  // (any nonzero count still exits 1). A flag has no such equivalent mutant.
  let hasViolation = false;
  for (const file of input.files) {
    const matched: string[] = [];
    file.content.split('\n').forEach((text, index) => {
      if (grantsIdTokenWrite(text)) {
        matched.push(`${index + 1}:${text}`); // `grep -n`: 1-based line number
      }
    });
    if (matched.length > 0) {
      lines.push(...matched);
      lines.push(`::error file=${file.path}::id-token: write is forbidden on the PR-time path (issues #272, #317)`);
      hasViolation = true;
    }
  }

  return { exitCode: hasViolation ? 1 : 0, lines };
}
