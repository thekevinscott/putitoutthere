export function pypiNameFor(pkg: { name: string; pypi?: string }): string {
  return pkg.pypi ?? pkg.name;
}
