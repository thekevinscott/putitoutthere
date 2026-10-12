export const PYPI_REGISTRY = 'https://pypi.org';

export function pypiNameFor(pkg: { name: string; pypi?: string }): string {
  return pkg.pypi ?? pkg.name;
}
