/**
 * Read a key whose presence the caller's construction guarantees, throwing a
 * labelled error if it is absent.
 *
 * `Map.get` widens its result to `V | undefined` even for a map the caller
 * seeded with every key it will ever read. Left to each call site, that gap
 * is papered over with an unreachable `?? default` fallback whose alternate
 * branch the 100%-coverage floor can never exercise — so it must be hidden
 * behind a `v8 ignore` marker. Routing the lookup through this one helper
 * tests the absent-key arm once, here, turning a broken seeding invariant
 * into a diagnosable throw instead of a silently-swallowed default. #577.
 *
 * A present key returns its stored value by reference (an empty array is a
 * value, not an absence, so it comes back untouched); an absent key throws
 * `${label}: ${key}`.
 */
export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`${label}: ${String(key)}`);
  }
  return value;
}
