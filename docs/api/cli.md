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

### `putitoutthere version`

Print the CLI version.

## Global flags

| Flag                  | Description                                                                                 |
|-----------------------|---------------------------------------------------------------------------------------------|
| `--cwd <path>`        | Working directory. Default: `process.cwd()`.                                                |
| `--config <path>`     | Path to `putitoutthere.toml`.                                                               |
| `--json`              | Machine-readable output.                                                                    |
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
