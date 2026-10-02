import type { Package } from './config.js';

/**
 * Index packages by their `name` for O(1) lookup. Names are unique (config load
 * enforces it), so the map is a total index over `packages` — callers that look
 * a planned name back up rely on that totality, which is why the lookup goes
 * through `mustGet` rather than a `?? default` (#577).
 */
export function packagesByName(packages: readonly Package[]): Map<string, Package> {
  return new Map(packages.map((p) => [p.name, p] as const));
}
