/**
 * Workflow templates emitted by `putitoutthere init`.
 *
 * Per plan.md §9.2 (immediate), §9.4 (scheduled), §9.5 (PR check).
 *
 * The `release.yml` templates follow the three-job shape
 * (plan → build → publish) so users can drop their build tooling into
 * the middle job without forking the orchestrator. Build steps are
 * keyed on `matrix.kind` (crates | pypi | npm) and `matrix.build`
 * (vanilla | maturin | napi | bundled-cli) so the right builder runs
 * per row.
 *
 * Issue #25. Plan: §9.
 */

export type Cadence = 'immediate' | 'scheduled';

export const TOML_SKELETON = `# Put It Out There — release orchestration config.
# Docs: https://github.com/thekevinscott/put-it-out-there

[putitoutthere]
version = 1

# Declare one [[package]] block per releasable artifact. Examples:
#
# [[package]]
# name = "my-crate"
# kind = "crates"
# path = "crates/my-crate"                 # dir containing Cargo.toml
# paths = ["crates/my-crate/**", "Cargo.toml", "Cargo.lock"]
# first_version = "0.1.0"
#
# [[package]]
# name = "my-py"
# kind = "pypi"
# path = "py/my-py"                        # dir containing pyproject.toml
# paths = ["py/my-py/**"]
# first_version = "0.1.0"
#
# [[package]]
# name = "my-pkg"
# kind = "npm"
# path = "packages/my-pkg"                 # dir containing package.json
# paths = ["packages/my-pkg/**"]
# first_version = "0.1.0"
`;

export const AGENTS_MD = `# Release signaling for Put It Out There

When you finish a unit of work and are preparing a PR or commit, add a git
trailer to the commit message body to signal a release:

    release: <patch|minor|major|skip>

Rules:
- Omit the trailer for docs-only, CI-only, or internal-only changes.
- \`patch\` for bug fixes or internal refactors that don't change public API.
- \`minor\` for new features that are backwards-compatible.
- \`major\` for breaking changes.
- \`skip\` to suppress release when path filters would otherwise cascade.

The trailer on the merge commit determines the release. If merging via
"Squash and merge," include the trailer in the PR description so it ends up
in the squashed commit body.

## Scoping a release to specific packages

To release a subset of packages in a polyglot repo, append a bracketed list:

    release: minor [dirsql-rust, dirsql-python]

Packages named in the list are bumped with the specified version. Other
packages cascaded by path filters still get a \`patch\`. Packages in the
list that *aren't* cascaded are force-included.
`;

const BUILD_JOB = `  build:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
    strategy:
      fail-fast: false
      matrix:
        include: \${{ fromJSON(needs.plan.outputs.matrix) }}
    runs-on: \${{ matrix.runs_on }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Setup Rust (if crates)
        if: matrix.kind == 'crates'
        uses: dtolnay/rust-toolchain@stable
      - name: Build crate
        if: matrix.kind == 'crates'
        run: cargo package --manifest-path \${{ matrix.path }}/Cargo.toml --target-dir \${{ matrix.path }}/target
      - name: Setup Python (if pypi)
        if: matrix.kind == 'pypi'
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Build wheel (maturin)
        if: matrix.kind == 'pypi' && matrix.build == 'maturin'
        uses: PyO3/maturin-action@v1
        with:
          command: build
          args: --release --out \${{ matrix.path }}/dist \${{ matrix.target == 'sdist' && '--sdist' || format('--target {0}', matrix.target) }}
          working-directory: \${{ matrix.path }}
      - name: Build sdist (setuptools/hatch)
        if: matrix.kind == 'pypi' && matrix.build != 'maturin' && matrix.target == 'sdist'
        run: |
          cd \${{ matrix.path }}
          python -m pip install build
          python -m build --sdist --outdir dist
      - name: Setup Node (if npm)
        if: matrix.kind == 'npm'
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Build npm package
        if: matrix.kind == 'npm'
        run: |
          cd \${{ matrix.path }}
          npm ci
          npm run build --if-present
      - uses: actions/upload-artifact@v4
        with:
          name: \${{ matrix.artifact_name }}
          path: \${{ matrix.artifact_path }}
`;

const PUBLISH_JOB = `  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
      - uses: thekevinscott/put-it-out-there@v0
        with:
          command: publish
          dry_run: \${{ inputs.dry_run || 'false' }}
        env:
          # NODE_AUTH_TOKEN (not NPM_TOKEN) matches the .npmrc template that
          # actions/setup-node writes when registry-url is set. putitoutthere's
          # preflight also accepts NPM_TOKEN as a fallback, but npm itself
          # reads this name. Store your npm secret under any name — we map it
          # here.
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_TOKEN }}
          PYPI_API_TOKEN: \${{ secrets.PYPI_API_TOKEN }}
`;

const PLAN_JOB = `  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: \${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: plan
        uses: thekevinscott/put-it-out-there@v0
        with:
          command: plan
`;

const IMMEDIATE_HEADER = `name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry-run: compute plan, skip publish + tag'
        type: boolean
        default: false

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
`;

const SCHEDULED_HEADER = `name: Release (scheduled)

on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry-run: compute plan, skip publish + tag'
        type: boolean
        default: false

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
`;

export const RELEASE_YML_IMMEDIATE = IMMEDIATE_HEADER + PLAN_JOB + '\n' + BUILD_JOB + '\n' + PUBLISH_JOB;
export const RELEASE_YML_SCHEDULED = SCHEDULED_HEADER + PLAN_JOB + '\n' + BUILD_JOB + '\n' + PUBLISH_JOB;

export const CHECK_YML = `name: Putitoutthere check

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: read

jobs:
  dry-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: thekevinscott/put-it-out-there@v0
        with:
          command: plan
          dry_run: true
          fail_on_error: true
`;

export function releaseYml(cadence: Cadence): string {
  /* v8 ignore next -- exhaustive switch */
  return cadence === 'scheduled' ? RELEASE_YML_SCHEDULED : RELEASE_YML_IMMEDIATE;
}
