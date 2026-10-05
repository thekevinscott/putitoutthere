/**
 * Read `{project, version}` off a Python distribution filename — PEP 625 for
 * sdists (`{name}-{version}.tar.gz`), PEP 427 for wheels
 * (`{name}-{version}(-{build})?-{python}-{abi}-{platform}.whl`), with `-`
 * escaped to `_` in the name half.
 *
 * Returns null for anything that is not one of those two shapes, so an
 * unrecognised file in `dist/` fails the gate loudly rather than silently
 * narrowing what the e2e tag job expects to have been published.
 */

export interface ParsedDistribution {
  project: string;
  version: string;
}

export function parseDistribution(filename: string): ParsedDistribution | null {
  const sdistSuffix = '.tar.gz';
  const sdist = filename.endsWith(sdistSuffix);
  // An sdist carries its extension inside the version field, so that comes
  // off before the split. A wheel carries it in the trailing platform field,
  // which this never reads — stripping it there would be unobservable, so it
  // is not stripped at all.
  const stem = sdist ? filename.slice(0, filename.length - sdistSuffix.length) : filename;
  const fields = stem.split('-');
  // `-` is escaped to `_` in the name half of both grammars, so the field
  // count is the entire shape check: 2 for an sdist, 5 or 6 for a wheel (the
  // 6th is the optional build tag). Every field is non-empty in both — an
  // empty one means a name or version slot the grammar left blank, which
  // would otherwise read as a real project or version.
  const counted =
    (sdist
      ? fields.length === 2
      : filename.endsWith('.whl') && fields.length >= 5 && fields.length <= 6) &&
    fields.every((field) => field !== '');
  if (!counted) {
    return null;
  }
  // `counted` has already proven at least two non-empty fields, but an index
  // is `string | undefined` under noUncheckedIndexedAccess. Asserted rather
  // than re-checked at runtime: a guard that cannot fire is a mutant no
  // assertion can kill.
  const [name, version] = fields as [string, string, ...string[]];
  // PEP 503: the escaped name maps back by replacing the runs of `_` the
  // filename grammar put there, and project names are compared lowercased.
  return { project: name.replaceAll('_', '-').toLowerCase(), version };
}
