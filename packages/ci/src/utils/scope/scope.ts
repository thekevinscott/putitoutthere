import { closure } from './closure.js';
import type { ScopeDeps, ScopeInput, ScopeUnit } from './scope-types.js';

export async function scope(input: ScopeInput, deps: ScopeDeps): Promise<ScopeUnit[]> {
  const changed = new Set(input.changed);
  const units = new Map<string, ScopeUnit>();
  for (const seed of input.seeds) {
    const reach = await closure([seed], deps);
    if (![...reach].some((path) => changed.has(path))) {
      continue;
    }
    const unit = input.toUnit(seed);
    units.set(JSON.stringify(unit), unit);
  }
  return [...units.values()];
}
