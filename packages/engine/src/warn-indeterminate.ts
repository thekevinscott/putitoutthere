export function warnIndeterminate(apiSlug: string, detail: string): void {
  process.stdout.write(
    `::warning::repository visibility check skipped for ${apiSlug}: ${detail}\n`,
  );
}
