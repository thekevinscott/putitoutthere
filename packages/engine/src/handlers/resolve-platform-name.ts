import type { NpmBuildMode } from './npm-platform.js';

/**
 * Resolve a platform-package name template. `{name}`, `{scope}`,
 * `{base}`, `{triple}`, and `{mode}` are substituted; unknown
 * placeholders throw (config-load validation should catch these
 * earlier — this guard is defensive).
 */
export function resolvePlatformName(
  template: string,
  vars: { name: string; triple: string; mode: NpmBuildMode },
): string {
  const scopedMatch = /^@([^/]+)\/(.+)$/.exec(vars.name);
  const scope = scopedMatch ? scopedMatch[1]! : '';
  const base = scopedMatch ? scopedMatch[2]! : vars.name;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    switch (key) {
      case 'name':
        return vars.name;
      case 'scope':
        return scope;
      case 'base':
        return base;
      case 'triple':
        return vars.triple;
      case 'mode':
        return vars.mode;
      /* v8 ignore start -- config-load validation rejects unknown placeholders; this branch is defensive */
      default:
        throw new Error(`unknown placeholder {${key}} in name template`);
    }
    /* v8 ignore stop */
  });
}
