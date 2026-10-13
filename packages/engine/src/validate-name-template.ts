// #dirsql: must mirror ALLOWED_NAME_VARIABLES in src/handlers/npm-platform.ts.
// `{version}` is intentionally excluded — see resolvePlatformName.
const NPM_NAME_TEMPLATE_VARS = ['name', 'scope', 'base', 'triple', 'mode'] as const;

export function validateNameTemplate(template: string): string | null {
  if (template.length === 0) {return 'name template must not be empty';}
  if (!template.includes('{triple}')) {
    return 'name template must contain {triple} (otherwise platform packages would collide)';
  }
  const allowed = new Set<string>(NPM_NAME_TEMPLATE_VARS);
  const unknown: string[] = [];
  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    const v = match[1]!;
    if (!allowed.has(v)) {unknown.push(v);}
  }
  if (unknown.length > 0) {
    return `name template contains unknown placeholder(s): ${[...new Set(unknown)].map((u) => `{${u}}`).join(', ')} (allowed: ${NPM_NAME_TEMPLATE_VARS.map((v) => `{${v}}`).join(', ')})`;
  }
  return null;
}
