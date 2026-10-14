export function collectBinsFromManifest(cargoToml: Record<string, unknown>): string[] {
  const result: string[] = [];
  const bins = cargoToml.bin;
  if (Array.isArray(bins)) {
    for (const entry of bins) {
      const name = (entry as { name?: unknown } | null | undefined)?.name;
      if (typeof name === 'string') {result.push(name);}
    }
  }
  // Cargo's implicit-binary rule: a crate without any [[bin]] table
  // ships a binary named after `[package].name` when `src/main.rs`
  // exists. We can't observe the filesystem here without extra reads,
  // but treating the implicit name as a candidate avoids false
  // positives on the common single-bin shape.
  if (result.length === 0) {
    const pkg = cargoToml.package as { name?: unknown } | undefined;
    if (pkg && typeof pkg.name === 'string') {result.push(pkg.name);}
  }
  return result;
}
