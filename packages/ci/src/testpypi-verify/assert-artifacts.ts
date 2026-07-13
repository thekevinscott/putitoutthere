/**
 * Decision core for the "Assert TestPyPI fixture artifacts exist" step. I/O-free:
 * given the basenames of the files under `dist/`, reproduce the bash's
 * `find dist -maxdepth 1 -type f -print | sort` listing (each as `dist/<name>`)
 * followed by the per-prefix guard that every fixture has both an sdist
 * (`<prefix>-*.tar.gz`) and a wheel (`<prefix>-*.whl`). The first missing
 * artifact emits the exact `::error::missing ...` line and stops with exit 1,
 * matching the bash loop order (maturin before hatch, sdist before wheel).
 */

const PREFIXES = ['piot_fixture_zzz_python_maturin', 'piot_fixture_zzz_python_hatch'] as const;

export interface AssertArtifactsDecision {
  lines: string[];
  exitCode: number;
}

export function decideAssertArtifacts(filenames: readonly string[]): AssertArtifactsDecision {
  const lines: string[] = filenames.map((name) => `dist/${name}`).sort();
  for (const prefix of PREFIXES) {
    if (!filenames.some((name) => name.startsWith(`${prefix}-`) && name.endsWith('.tar.gz'))) {
      lines.push(`::error::missing ${prefix} sdist artifact for TestPyPI`);
      return { lines, exitCode: 1 };
    }
    if (!filenames.some((name) => name.startsWith(`${prefix}-`) && name.endsWith('.whl'))) {
      lines.push(`::error::missing ${prefix} wheel artifact for TestPyPI`);
      return { lines, exitCode: 1 };
    }
  }
  return { lines, exitCode: 0 };
}
