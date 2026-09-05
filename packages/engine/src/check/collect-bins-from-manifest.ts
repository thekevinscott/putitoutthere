export function collectBinsFromManifest(parsed: Record<string, unknown>): string[] {
  const result: string[] = [];
  const bins = parsed.bin;
  if (Array.isArray(bins)) {
    for (const entry of bins) {
      if (typeof entry === 'object' && entry !== null) {
        const name = (entry as { name?: unknown }).name;
        if (typeof name === 'string') {result.push(name);}
      }
    }
  }
  // Cargo's implicit-binary rule: a crate without any explicit [[bin]]
  // table ships a binary named after `[package].name` when
  // `src/main.rs` exists. Include that name as a candidate so the
  // common single-binary shape (one crate, one bin, no [[bin]] block)
  // doesn't spuriously fail this check.
  if (result.length === 0) {
    const pkg = parsed.package as { name?: unknown } | undefined;
    if (pkg && typeof pkg.name === 'string') {result.push(pkg.name);}
  }
  return result;
}
