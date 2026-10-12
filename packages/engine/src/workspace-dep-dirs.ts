import { isAbsolute, resolve } from 'node:path';

/**
 * `[workspace.dependencies]` entries that carry a `path`, keyed by name and
 * already resolved against `workspaceRoot` — the manifest that declared
 * them, and therefore the base those relative paths are written against.
 */
export function workspaceDepDirs(
  workspaceParsed: unknown,
  workspaceRoot: string,
): Map<string, { dir: string; hasVersionReq: boolean }> {
  const map = new Map<string, { dir: string; hasVersionReq: boolean }>();
  // Optional chaining rather than a guard per level: a primitive yields
  // `undefined` for the next lookup anyway, so only null/undefined need
  // handling and each `typeof` arm would be unobservable.
  const workspace = (workspaceParsed as { workspace?: unknown } | null)?.workspace;
  const deps = (workspace as { dependencies?: unknown } | null)?.dependencies;

  for (const [key, value] of Object.entries((deps ?? {}) as Record<string, unknown>)) {
    const obj = (value ?? {}) as Record<string, unknown>;
    if (typeof obj['path'] !== 'string') {continue;}
    map.set(key, {
      dir: absolute(obj['path'], workspaceRoot),
      hasVersionReq: typeof obj['version'] === 'string',
    });
  }
  return map;
}

export function absolute(p: string, base: string): string {
  return isAbsolute(p) ? p : resolve(base, p);
}
