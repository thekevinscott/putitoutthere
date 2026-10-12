// Common consumer typos that zod's raw output describes too obliquely to
// recover from without re-reading the schema. Each detection names both
// the mistake and the fix so the failing CI log is self-explanatory.
// Triggered by the integration failure in #integration-2026-05.
export function detectCommonMistakes(raw: unknown): string[] {
  const hints: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {return hints;}
  const root = raw as Record<string, unknown>;

  if (!('putitoutthere' in root) && 'version' in root) {
    hints.push(
      'missing [putitoutthere] table — move `version` under it: `[putitoutthere]\\nversion = 1`',
    );
  }
  if ('packages' in root && !('package' in root)) {
    hints.push(
      'top-level table is `[[packages]]` (plural) but should be `[[package]]` (singular)',
    );
  }

  const pkgs = root.package ?? root.packages;
  if (Array.isArray(pkgs)) {
    pkgs.forEach((p, i) => {
      if (typeof p !== 'object' || p === null) {return;}
      const pp = p as Record<string, unknown>;
      if ('registry' in pp && !('kind' in pp)) {
        hints.push(`package[${i}]: \`registry = ...\` is not a valid field; did you mean \`kind\`?`);
      }
      if ('files' in pp && !('globs' in pp)) {
        hints.push(`package[${i}]: \`files = ...\` is not a valid field; did you mean \`globs\`?`);
      }
    });
  }

  return hints;
}
