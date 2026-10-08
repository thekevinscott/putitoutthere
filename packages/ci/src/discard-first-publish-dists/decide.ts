export function isFirstPublishArtifact(name: string): boolean {
  return name.includes('_placeholder') || name.includes('-placeholder');
}

export function droppedWarning(count: number): string {
  return `::warning::Dropped ${count} first-publish artifact(s) from dist/ — Trusted Publisher records are not provisioned for uniquified package names. The maturin build path on a first-publish fixture is guarded by the in-job wheel-content guard, not by the real-PyPI upload.`;
}
