/**
 * Result of selecting the single metadata member (wheel `METADATA` / sdist
 * `PKG-INFO`) to read from an archive: either the chosen member name or the
 * exact `::error`-free failure line the bash printed to stderr.
 */

export type MemberSelection = { member: string } | { errorLine: string };
