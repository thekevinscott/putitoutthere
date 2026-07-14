/**
 * Choose the downloaded wheel to inspect for a requirement, reproducing the
 * bash's `sorted(wheels_dir.glob(f"{stem}-{version}-*.whl"))[0]`: the
 * lexicographically first basename that starts with `{stem}-{version}-` and
 * ends with `.whl`, or `null` when none was downloaded. Pure.
 */

export function selectDownloadedWheel(
  filenames: readonly string[],
  stem: string,
  version: string,
): string | null {
  const prefix = `${stem}-${version}-`;
  const [match] = filenames.filter((name) => name.startsWith(prefix) && name.endsWith('.whl')).sort();
  return match ?? null;
}
