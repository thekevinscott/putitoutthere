/**
 * Choose the downloaded sdist to inspect for a requirement, reproducing the
 * bash's `sorted(sdists_dir.glob(f"{stem}-{version}.tar.gz"))[0]`: that glob
 * has no wildcard, so it matches the exact `{stem}-{version}.tar.gz` basename
 * (of which there is at most one, so no ordering is needed). Returns it when
 * present, else `null`. Pure.
 */

export function selectDownloadedSdist(
  filenames: readonly string[],
  stem: string,
  version: string,
): string | null {
  const target = `${stem}-${version}.tar.gz`;
  const [match] = filenames.filter((name) => name === target);
  return match ?? null;
}
