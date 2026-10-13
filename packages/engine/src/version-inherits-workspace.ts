export function versionInheritsWorkspace(version: unknown): boolean {
  return (
    typeof version === 'object' &&
    version !== null &&
    (version as { workspace?: unknown }).workspace === true
  );
}
