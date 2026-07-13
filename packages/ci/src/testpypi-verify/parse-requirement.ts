/**
 * Split a `name==version` requirement line into its parts, reproducing the
 * bash's `package, version = req.split("==", 1)` plus the
 * `stem = package.replace("-", "_")` used to match distribution filenames.
 * Splits on the first `==`. Pure.
 */

export interface ParsedRequirement {
  package: string;
  version: string;
  stem: string;
}

export function parseRequirement(requirement: string): ParsedRequirement {
  const separator = requirement.indexOf('==');
  const pkg = requirement.slice(0, separator);
  const version = requirement.slice(separator + '=='.length);
  return { package: pkg, version, stem: pkg.split('-').join('_') };
}
