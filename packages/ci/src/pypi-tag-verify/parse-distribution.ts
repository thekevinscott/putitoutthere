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
  const wheelSuffix = '.whl';
  let fields: string[];
  if (filename.endsWith(sdistSuffix)) {
    fields = filename.slice(0, filename.length - sdistSuffix.length).split('-');
    if (fields.length !== 2) {
      return null;
    }
  } else if (filename.endsWith(wheelSuffix)) {
    fields = filename.slice(0, filename.length - wheelSuffix.length).split('-');
    // name, version, [build], python, abi, platform.
    if (fields.length < 5 || fields.length > 6) {
      return null;
    }
  } else {
    return null;
  }
  const [name, version] = fields;
  if (name === undefined || name === '' || version === undefined || version === '') {
    return null;
  }
  // PEP 503: the escaped name maps back by replacing the runs of `_` the
  // filename grammar put there, and project names are compared lowercased.
  return { project: name.replaceAll('_', '-').toLowerCase(), version };
}
