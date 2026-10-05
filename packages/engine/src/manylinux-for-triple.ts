/**
 * #610: resolve which linux wheel rows a package's `manylinux` baseline applies
 * to. maturin-action's `manylinux` input selects a container per libc family —
 * `manylinux*` only for `-gnu` triples, `musllinux_X_Y` only for `-musl` — so a
 * mismatched pair (or any non-linux triple) gets no baseline.
 */
export function manylinuxForTriple(
  triple: string,
  manylinux: string | undefined,
): string | undefined {
  if (manylinux === undefined) {
    return undefined;
  }
  const isMusllinuxValue = manylinux.startsWith('musllinux_');
  // `includes` (not `endsWith`) so eabi variants match too:
  // armv7-unknown-linux-gnueabihf, arm-unknown-linux-musleabi, …
  if (triple.includes('-linux-gnu') && !isMusllinuxValue) {
    return manylinux;
  }
  if (triple.includes('-linux-musl') && isMusllinuxValue) {
    return manylinux;
  }
  return undefined;
}
