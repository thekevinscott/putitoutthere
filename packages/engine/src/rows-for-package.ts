import { sanitizeArtifactName, type Package } from './config.js';
import { defaultRunsOn } from './default-runs-on.js';
import {
  assertTripleSupported,
  normalizeBuild,
  platformArtifactName,
  toRustTriple,
  type NpmBuildField,
} from './handlers/npm-platform.js';
import { manylinuxForTriple } from './manylinux-for-triple.js';
import type { MatrixRow } from './plan.js';
import { resolvePythonVersions } from './python-versions.js';
import { normalizeTarget, type TargetEntry } from './types.js';
import { isVersionIndependentWheel } from './wheel-abi.js';

export async function rowsForPackage(pkg: Package, version: string, cwd: string): Promise<MatrixRow[]> {
  // actions/upload-artifact@v4 forbids `/` in artifact names (#230) and rejects
  // paths starting `./` or equal to `.` (#244, what `${pkg.path}/dist` yields
  // when `path = "."`). So slashed names are encoded here — config load rejects
  // the encoding sequence, keeping the round-trip unambiguous — and `joinPath`.
  const safe = sanitizeArtifactName(pkg.name);
  const at = (subdir: string): string => joinPath(pkg.path, subdir);
  switch (pkg.kind) {
    case 'crates':
      return [
        {
          name: pkg.name,
          kind: 'crates',
          version,
          target: 'noarch',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-crate`,
          artifact_path: at('target/package'),
          path: pkg.path,
        },
      ];

    case 'pypi': {
      // `pkg` is narrowed to the pypi variant here, whose `build` the Zod
      // schema defaults to `'setuptools'` — so it is always defined.
      const build = pkg.build;
      const targets = (pkg as { targets?: TargetEntry[] }).targets ?? [];
      const bundleCli = (pkg as { bundle_cli?: MatrixRow['bundle_cli'] }).bundle_cli;
      const manylinux = (pkg as { manylinux?: string }).manylinux;
      // #369: every wheel is built for a specific CPython version.
      // Resolve the set — config `python_versions` override, else
      // `requires-python` inference, else a single default — and fan
      // the maturin per-target wheel rows across it.
      const pyVersions = await resolvePythonVersions(pkg, cwd);
      // The sdist and pure-Python hatch wheel are version-agnostic but
      // still need an interpreter to run the build; use the newest
      // resolved version.
      const buildPython = pyVersions[pyVersions.length - 1]!;
      // #401: a maturin wheel that is Python-version-independent — a
      // `bindings = "bin"` Rust-binary wheel (`py3-none`) or a pyo3 abi3
      // extension (`cp3x-abi3`) — is byte-identical across the resolved
      // interpreter set. Fanning the build across it produces N
      // duplicate wheels that then race-corrupt at the consumer's
      // `merge-multiple` download. Collapse the fan to a single wheel
      // built on the newest resolved interpreter.
      const wheelPyVersions =
        build === 'maturin' && (await isVersionIndependentWheel(pkg.path, cwd))
          ? [buildPython]
          : pyVersions;
      const multiPy = wheelPyVersions.length > 1;
      const out: MatrixRow[] = [];
      if (build === 'maturin') {
        for (const entry of targets) {
          const { triple, runner } = normalizeTarget(entry);
          for (const py of wheelPyVersions) {
            const row: MatrixRow = {
              name: pkg.name,
              kind: 'pypi',
              version,
              target: triple,
              runs_on: runner ?? defaultRunsOn(triple),
              // A single planned version keeps the historical
              // unsuffixed artifact name; a multi-version fan adds a
              // `-py<ver>` slot so per-version wheels for the same
              // triple don't collide at upload.
              artifact_name: multiPy
                ? `${safe}-wheel-${triple}-py${py}`
                : `${safe}-wheel-${triple}`,
              artifact_path: at('dist'),
              path: pkg.path,
              build,
              python_version: py,
            };
            // #217: per-target wheels carry bundle_cli; sdist does not.
            if (bundleCli !== undefined) {row.bundle_cli = bundleCli;}
            // #610: per-target linux wheels of the matching libc family
            // carry the manylinux baseline; sdist/darwin/windows do not.
            const rowManylinux = manylinuxForTriple(triple, manylinux);
            if (rowManylinux !== undefined) {row.manylinux = rowManylinux;}
            out.push(row);
          }
        }
      }
      // Always emit an sdist row for pypi. Source-only — no staged
      // binary, no bundle_cli field.
      out.push({
        name: pkg.name,
        kind: 'pypi',
        version,
        target: 'sdist',
        runs_on: 'ubuntu-latest',
        artifact_name: `${safe}-sdist`,
        artifact_path: at('dist'),
        path: pkg.path,
        python_version: buildPython,
        // `build` is non-optional post-parse (defaults to 'setuptools'), so
        // the sdist row always carries it — no conditional spread.
        build,
      });
      // #324: pure-Python hatch packages also emit a `wheel-any` row.
      // `pypa/build`'s default on a pure-Python tree produces both an
      // sdist and an any-platform wheel; sdist-only meant downstream
      // `pip install` / `uvx ...` had to provision hatchling and run
      // `python -m build` on a cold cache. Scoped to hatch per the
      // issue — setuptools stays sdist-only, maturin keeps its
      // per-target wheel rows.
      if (build === 'hatch') {
        out.push({
          name: pkg.name,
          kind: 'pypi',
          version,
          target: 'any',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-wheel-any`,
          artifact_path: at('dist'),
          path: pkg.path,
          build,
          python_version: buildPython,
        });
      }
      return out;
    }

    case 'npm': {
      const rawBuild = (pkg as { build?: NpmBuildField }).build;
      const buildEntries = normalizeBuild(rawBuild);
      const targets = (pkg as { targets?: TargetEntry[] }).targets ?? [];
      // #298: bundle_cli attaches to bundled-cli per-target rows only.
      // Schema guarantees the block is only present when at least one
      // bundled-cli entry exists in `build` AND `targets` is non-empty.
      const bundleCli = (pkg as { bundle_cli?: MatrixRow['bundle_cli'] }).bundle_cli;
      if (buildEntries.length > 0) {
        // Plan-time guard: bail before a CI matrix runs on an unmapped
        // triple. Handler-time validation remains as belt-and-suspenders.
        // Issue #170 follow-up.
        for (const tEntry of targets) {
          assertTripleSupported(normalizeTarget(tEntry).triple, pkg.name);
        }
        const isMulti = buildEntries.length > 1;
        const out: MatrixRow[] = [];
        for (const bEntry of buildEntries) {
          for (const tEntry of targets) {
            const { triple, runner } = normalizeTarget(tEntry);
            // #dirsql: multi-mode rows carry a mode infix in both the
            // artifact-name and artifact-path so napi `.node` files and
            // bundled-cli binaries don't collide on the build side.
            // Single-mode shape preserved byte-for-byte.
            const artifactName = platformArtifactName(pkg.name, bEntry.mode, triple, isMulti);
            const artifactPath = isMulti
              ? at(`build/${bEntry.mode}-${triple}`)
              : at(`build/${triple}`);
            const row: MatrixRow = {
              name: pkg.name,
              kind: 'npm',
              version,
              target: triple,
              runs_on: runner ?? defaultRunsOn(triple),
              artifact_name: artifactName,
              artifact_path: artifactPath,
              path: pkg.path,
              build: bEntry.mode,
            };
            // #298: bundled-cli per-target rows carry the cross-compile
            // metadata. napi rows in a multi-mode package don't — napi
            // has its own toolchain and stages `.node` files differently.
            // The main row also doesn't carry bundle_cli (no per-target
            // binary to compile at the top-level).
            if (bundleCli !== undefined && bEntry.mode === 'bundled-cli') {
              row.bundle_cli = bundleCli;
              // #387: resolve the npm-flavor triple to its Rust form once,
              // here, so the cross-compile steps read `matrix.rust_target`
              // instead of mapping inline in shell. `assertTripleSupported`
              // above guarantees the triple is mapped, so this never throws.
              row.rust_target = toRustTriple(triple);
            }
            out.push(row);
          }
        }
        // Plus the main package row. The main row's `build` is informational
        // (no per-target compile happens for it); we set it to the first
        // entry's mode so length-1 array forms match the string-form shape.
        out.push({
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'main',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-main`,
          artifact_path: at('package.json'),
          path: pkg.path,
          build: buildEntries[0]!.mode,
        });
        return out;
      }
      // Vanilla mode: single noarch row.
      return [
        {
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'noarch',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-pkg`,
          artifact_path: at('package.json'),
          path: pkg.path,
        },
      ];
    }
  }
}

/**
 * Join `base` + `subdir` into a path that `actions/upload-artifact@v4`
 * accepts. Special-cases `base === '.'` to avoid the `./subdir` /
 * leading-`./` shape the action rejects (#244).
 */
function joinPath(base: string, subdir: string): string {
  return base === '.' ? subdir : `${base}/${subdir}`;
}
