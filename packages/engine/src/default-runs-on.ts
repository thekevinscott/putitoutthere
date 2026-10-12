/**
 * Per-target default GHA runner. Native runners where available, else
 * cross-compile on ubuntu. Plan §12.3 calls these out as "opinionated
 * defaults; user can override".
 */
export function defaultRunsOn(target: string): string {
  if (target.includes('apple-darwin') || target.includes('darwin') || target.includes('mac')) {
    return 'macos-latest';
  }
  if (target.includes('windows') || target.includes('win32') || target.includes('msvc')) {
    // Pinned: GitHub is migrating windows-latest → windows-2025-vs2026
    // between 2026-06-08 and 2026-06-15. Tracking the floating label would
    // silently move every consumer's Windows release runs onto VS2026 on
    // the cutover. Consumers that want a different image opt in via the
    // per-target `{ triple, runner }` override. See issue #354.
    return 'windows-2022';
  }
  if (target.includes('aarch64-unknown-linux') || target.includes('aarch64-linux')) {
    // Native arm runners are free for public repos.
    return 'ubuntu-24.04-arm';
  }
  return 'ubuntu-latest';
}
