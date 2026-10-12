export function cratesRegistry(): string {
  return 'https://crates.io';
}

/** The published name. Falls back to the pilot package name if no
 * explicit `crate` field is set. */
export function crateNameFor(pkg: { name: string; crate?: string }): string {
  return pkg.crate ?? pkg.name;
}
