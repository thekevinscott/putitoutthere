export const isFirstPublishArtifact = (name: string): boolean => name.includes('_placeholder') || name.includes('-placeholder');

export const droppedWarning = (count: number): string =>
  `::warning::Dropped ${count} first-publish artifact(s) from dist/ — Trusted Publisher records are not provisioned for uniquified package names. The maturin build path on a first-publish fixture is guarded by the in-job wheel-content guard, not by the real-PyPI upload.`;
