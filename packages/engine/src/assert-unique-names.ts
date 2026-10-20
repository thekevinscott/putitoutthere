import type { Package } from './config.js';

export function assertUniqueNames(packages: readonly Package[]): void {
  const seen = new Set<string>();
  for (const p of packages) {
    if (seen.has(p.name)) {
      throw new Error(`putitoutthere.toml: duplicate package name: ${p.name}`);
    }
    seen.add(p.name);
  }
}
