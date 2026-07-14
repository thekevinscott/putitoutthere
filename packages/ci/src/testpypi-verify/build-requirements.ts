/**
 * Decision core for the requirements-building heredoc of the "Verify TestPyPI
 * artifact metadata" step. I/O-free: given the basenames under `dist/`, derive
 * one `pinned` requirement per fixture package by collecting the version from
 * every matching sdist/wheel and demanding exactly one, reproducing the bash's
 *
 *   for artifact in dist.glob(f"{stem}-*"):
 *     if name.endswith(".tar.gz"): versions.add(name.removeprefix(f"{stem}-").removesuffix(".tar.gz"))
 *     elif name.endswith(".whl"):  versions.add(name.split("-")[1])
 *   if len(versions) != 1: <error>; version = versions.pop(); print(f"{package}=={version}")
 */

import { pyStrList } from './py-str-list.js';

const PACKAGES = [
  { name: 'piot-fixture-zzz-python-maturin', stem: 'piot_fixture_zzz_python_maturin' },
  { name: 'piot-fixture-zzz-python-hatch', stem: 'piot_fixture_zzz_python_hatch' },
] as const;

export type BuildRequirementsResult = { requirements: string[] } | { errorLine: string };

export function buildRequirements(filenames: readonly string[]): BuildRequirementsResult {
  const requirements: string[] = [];
  for (const { name, stem } of PACKAGES) {
    const prefix = `${stem}-`;
    const versions = new Set<string>();
    for (const filename of filenames) {
      if (!filename.startsWith(prefix)) {
        continue;
      }
      if (filename.endsWith('.tar.gz')) {
        const withoutPrefix = filename.slice(prefix.length);
        versions.add(withoutPrefix.slice(0, withoutPrefix.length - '.tar.gz'.length));
      } else if (filename.endsWith('.whl')) {
        // Equivalent to the bash's `name.split("-")[1]`: the stem carries no
        // dash, so the version is the segment after `{stem}-` up to the next
        // dash (or the whole remainder when there is none).
        const rest = filename.slice(prefix.length);
        const dash = rest.indexOf('-');
        versions.add(dash === -1 ? rest : rest.slice(0, dash));
      }
    }
    const sorted = [...versions].sort();
    const [version, ...rest] = sorted;
    if (version === undefined || rest.length > 0) {
      return { errorLine: `expected exactly one version for ${name}, found ${pyStrList(sorted)}` };
    }
    requirements.push(`${name}==${version}`);
  }
  return { requirements };
}
