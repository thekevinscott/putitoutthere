/**
 * Read a key whose presence the caller's construction guarantees, throwing if
 * it is absent. `Map.get` widens to `V | undefined` even for a totally-seeded
 * map, and the usual `?? default` papers over a broken invariant with a branch
 * no coverage floor can reach; this tests the absent arm once, here. #577.
 */
export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`mustGet: no value seeded for key ${String(key)}`);
  }
  return value;
}
