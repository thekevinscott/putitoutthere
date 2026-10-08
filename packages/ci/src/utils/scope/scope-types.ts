export type ScopeUnit = Readonly<Record<string, string>>;

export interface ScopeDeps {
  readFile: (path: string) => Promise<string | undefined>;
  extractRefs: (path: string, content: string) => readonly string[];
}

export interface ScopeInput {
  seeds: readonly string[];
  changed: readonly string[];
  toUnit: (seed: string) => ScopeUnit;
}
