# CLI reference

`putitoutthere` is the CLI shipped with the npm package. It is the supported
surface, alongside the [GitHub Action](./action.md). The npm package does not
expose a programmatic SDK — `import 'putitoutthere'` only provides shared
types and the `AuthError` / `TransientError` classes.

## Commands

### `putitoutthere init`

Scaffold a fresh repo.

```
putitoutthere init [--cwd <path>] [--cadence immediate|scheduled] [--force] [--json]
```

Writes `putitoutthere.toml`, `putitoutthere/AGENTS.md`, `.github/workflows/release.yml`, `.github/workflows/putitoutthere-check.yml`. Appends `@putitoutthere/AGENTS.md` to `CLAUDE.md`.

### `putitoutthere plan`

Compute the release plan. Emits a JSON matrix that the `build` job consumes.

```
putitoutthere plan [--cwd <path>] [--config <path>] [--json]
```

When `$GITHUB_OUTPUT` is set (CI), writes `matrix=<JSON>` to it.

### `putitoutthere publish`

Execute the plan.

```
putitoutthere publish [--cwd <path>] [--config <path>] [--dry-run] [--json]
```

Flow: re-run plan → preflight auth → completeness → toposort → per package `writeVersion` + `handler.publish` + git tag + push.

### `putitoutthere doctor`

Validate config + per-package auth. Returns a report (0 on clean, 1 on issues).

```
putitoutthere doctor [--cwd <path>] [--config <path>] [--artifacts] [--deep] [--json]
```

### `putitoutthere preflight`

Run every pre-publish check (auth, token scope, config) without side effects. Exits 0 on pass, 1 on fail.

```
putitoutthere preflight [--cwd <path>] [--config <path>] [--all] [--json]
```

`--all` includes packages outside the current cascade.

### `putitoutthere token`

Inspect or list registry tokens (`pypi` / `npm` / `crates`).

```
putitoutthere token inspect [--token <value>] [--registry <pypi|npm|crates>] [--json]
putitoutthere token list    [--cwd <path>] [--config <path>] [--secrets] [--json]
```

`inspect` reads `--token` (or the matching registry env var) and reports its scope. `list` enumerates registry tokens visible in the environment; `--secrets` additionally queries GitHub repo/environment secrets (requires `putitoutthere auth login` first).

### `putitoutthere auth`

Optional GitHub Device Flow sign-in. Only needed for `token list --secrets`.

```
putitoutthere auth login   [--json]
putitoutthere auth logout  [--json]
putitoutthere auth status  [--json]
```

**What `doctor` checks:**

- `putitoutthere.toml` parses, is schema-valid, and has no `depends_on` cycles.
- For each package: the referenced `path` exists and contains the manifest
  the handler expects (`Cargo.toml` / `pyproject.toml` / `package.json`).
- Auth is reachable for every declared registry. For OIDC-first handlers,
  that means: `id-token: write` permission is present in the current
  workflow; for long-lived-token fallbacks, the relevant env var is set
  and non-empty.

**What `doctor` does not check:**

- That a **trusted publisher is registered on the registry** for the
  current repo/workflow. This is one-time out-of-CI setup (see
  [Authentication](/guide/auth)) and has to be verified against each
  registry's settings UI.
- That the **caller workflow filename matches the registered trust
  policy.** PyPI and crates.io pin the filename in the OIDC JWT; piot
  does not introspect the registered policy to confirm your
  `release.yml` matches. A mismatch fails at publish with an HTTP 400;
  the fix is to re-register the policy (or rename the file) and retry.
  npm provenance does not pin a workflow filename, so renames are free
  on the npm side.
- That a specific **target triple is buildable on the runner your
  workflow selected.** Build-matrix correctness lives in your workflow
  YAML, not in `putitoutthere.toml`.

### `putitoutthere version`

Print the CLI version. Equivalent forms: `putitoutthere version`, `putitoutthere --version`, `putitoutthere -v`.

### `putitoutthere --help`

Print the usage block to stderr and exit 0. Equivalent: `putitoutthere -h`.

## Global flags

| Flag                  | Description                                                                                 |
|-----------------------|---------------------------------------------------------------------------------------------|
| `--cwd <path>`        | Working directory. Default: `process.cwd()`.                                                |
| `--config <path>`     | Path to `putitoutthere.toml`.                                                               |
| `--json`              | Machine-readable output. Supported on `init`, `plan`, `publish`, `doctor`, `preflight`, `token list`, `token inspect`, `auth login`, `auth logout`, `auth status`. |
| `--dry-run`           | (publish) Skip side effects.                                                                |
| `--force`             | (init) Overwrite `putitoutthere.toml`.                                                      |
| `--cadence <mode>`    | (init) `immediate` (default) or `scheduled`.                                                |
| `--artifacts`         | (doctor) Also check artifact completeness.                                                  |
| `--deep`              | (doctor) Also inspect each token's publish scope.                                           |
| `--preflight-check`   | (publish) Refuse on token scope mismatch (pypi/npm).                                        |
| `--all`               | (preflight) Include non-cascaded packages too.                                              |
| `--secrets`           | (token list) Also list GitHub repo/environment secrets (requires `auth login`).             |
| `--token <value>`     | (token inspect) Token value (else read from env).                                           |
| `--registry <r>`      | (token inspect) `crates` \| `npm` \| `pypi`.                                                |

## Exit codes

| Code | Meaning                                                                  |
|------|--------------------------------------------------------------------------|
| `0`  | Success. `doctor` and `preflight` exit `0` only when every check passes; `auth status` exits `0` only when authenticated. |
| `1`  | Validation, configuration, or auth failure (unknown command, bad flag, schema error, `doctor`/`preflight` reported issues, `auth status` not logged in, `token inspect` reported an error). |
| `4`  | Unhandled fatal error (uncaught exception). The error message goes to stderr; this code is set by the binary entry point in `src/cli-bin.ts`. |
