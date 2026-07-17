import type { Package } from './config.js';

/**
 * Index packages by their `name` for O(1) lookup.
 *
 * Package names are unique — config load enforces it — so the returned map is
 * a total index over `packages`: every name maps to exactly its package, and
 * the map's size equals the list's length. Callers that look a planned name
 * back up (publish's auth pre-flight and publish loop) rely on that totality,
 * which is why the lookup goes through `mustGet` rather than a `?? default`.
 *
 * Extracted to its own file (#577) so the map-building `.map((p) => [p.name,
 * p])` is exercised by a colocated test that asserts the name→package
 * mapping directly, instead of being an inline expression whose only witness
 * is publish()'s far-downstream behavior.
 */
export function packagesByName(packages: readonly Package[]): Map<string, Package> {
  return new Map(packages.map((p) => [p.name, p] as const));
}
