/**
 * Classify a pypi package's declared dynamic version source by whether a
 * release run can reach it (#696). Only hatch-vcs / setuptools-scm (which
 * honour `SETUPTOOLS_SCM_PRETEND_VERSION`) and maturin keep the `dynamic`
 * promise; plain hatchling `[tool.hatch.version] path` reads a literal off disk.
 */

import { buildRequiresDeclares } from './build-requires-declares.js';

export type PypiUnreachableVersionCode =
  | 'PIOT_PYPI_HATCH_VERSION_PATH'
  | 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND';

export type PypiVersionSourceVerdict =
  | { readonly reachable: true }
  | {
      readonly reachable: false;
      readonly code: PypiUnreachableVersionCode;
      readonly detail: string;
    };

export function classifyPypiVersionSource(
  buildSystem: Record<string, unknown>,
  tool: Record<string, unknown>,
): PypiVersionSourceVerdict {
  // The verdict and its detail strings are function-scope, not module-scope:
  // a module-level initializer runs once at import time, before the mutation
  // runner can activate a mutant on it, so a constant up there is unkillable
  // by any assertion in here no matter how tightly the detail is pinned.
  const reachable: PypiVersionSourceVerdict = { reachable: true };
  const noVersionTable =
    '[project].dynamic includes "version" but neither [tool.hatch.version] nor [tool.setuptools_scm] is present; the build backend has no way to compute a version';
  const hatchVcsNotDeclared =
    '[tool.hatch.version].source = "vcs" names hatch-vcs\'s plugin entry point, but "hatch-vcs" is not in [build-system].requires; hatchling fails mid-build with `Unknown version source: vcs`';
  const scmNotDeclared =
    '[tool.setuptools_scm] is present but "setuptools-scm" is not in [build-system].requires; without the plugin installed setuptools falls back to no version at all';
  // Every hatchling version source other than `vcs` resolves to a file in
  // the tree: the default `regex` source (implied by a bare `path`) reads a
  // literal out of it, and `source = "code"` imports it. Neither sees
  // SETUPTOOLS_SCM_PRETEND_VERSION, and nothing in a release run edits the
  // file, so the wheel ships whatever is committed.
  const hatchPathSource =
    '[tool.hatch.version] resolves the version from a file in the tree, which no release step rewrites (write-version is maturin-only) and which hatchling reads without consulting SETUPTOOLS_SCM_PRETEND_VERSION -- the wheel would ship the committed literal, not the planned version. Use source = "vcs" with "hatch-vcs" in [build-system].requires (or [tool.setuptools_scm] with "setuptools-scm")';

  const requires = buildSystem.requires;
  const hatch = isTable(tool.hatch) ? tool.hatch : {};
  const hatchVersion = isTable(hatch.version) ? hatch.version : undefined;
  const hasSetuptoolsScm = isTable(tool.setuptools_scm);
  if (hasSetuptoolsScm && buildRequiresDeclares(requires, 'setuptools-scm')) {
    return reachable;
  }
  if (hatchVersion?.source === 'vcs') {
    return buildRequiresDeclares(requires, 'hatch-vcs')
      ? reachable
      : {
          reachable: false,
          code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
          detail: hatchVcsNotDeclared,
        };
  }
  if (hatchVersion !== undefined) {
    const path = typeof hatchVersion.path === 'string' ? hatchVersion.path : '(no path declared)';
    return {
      reachable: false,
      code: 'PIOT_PYPI_HATCH_VERSION_PATH',
      detail: `${hatchPathSource}. Declared path: "${path}"`,
    };
  }
  if (hasSetuptoolsScm) {
    return {
      reachable: false,
      code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
      detail: scmNotDeclared,
    };
  }
  return {
    reachable: false,
    code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
    detail: noVersionTable,
  };
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
