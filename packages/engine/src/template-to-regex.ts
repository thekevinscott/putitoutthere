export function templateToRegex(template: string, name: string): RegExp {
  const pattern = escapeRegex(template)
    .replace(/\\\{name\\\}/g, escapeRegex(name))
    .replace(/\\\{version\\\}/g, '(.+)');
  return new RegExp(`^${pattern}$`);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
