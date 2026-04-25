# Runner prerequisites

`putitoutthere` shells out to per-language tools (`twine`, `cargo`,
`npm`) and to `git`. The scaffolded `release.yml` covers the common
needs, but depending on your shape, a few runner-level prerequisites
need wiring before `putitoutthere publish` runs.

This page is the single reference for those prerequisites. Every
shape guide links here rather than repeating the list.

## PyPI: `twine` + Python

The PyPI handler calls `twine upload` as a subprocess. Hosted GitHub
runners don't ship twine on PATH, so the publish job must install it
before the piot step:

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: '3.12'
- name: Install twine
  run: pip install twine
```

Without these steps, the publish job fails with:

```
pypi: twine not found on PATH (ENOENT).
Did the publish job run `pip install twine` before the piot step?
See https://thekevinscott.github.io/putitoutthere/guide/runner-prerequisites
```

Python minor version is flexible — `3.10`+ all work. We pick `3.12` in
the scaffolded workflow; pin yours to whatever you test against.

### Why doesn't piot bundle twine?

piot is a Node CLI. Bundling twine would mean either shipping a
Python runtime with the Action (enormous) or pulling it at runtime
(slow + brittle). Every Actions workflow already has a mechanism for
installing Python packages — `setup-python` + `pip install`. We use
that mechanism instead of reinventing it.

The scaffolded `release.yml` emitted by `putitoutthere init`
**includes** these steps when your config has a `kind = "pypi"`
package; this page is for readers adapting an existing workflow or
debugging a failed run.

## Git committer identity

piot cuts an **annotated** tag per successful publish
(`git tag -a -m …`). Annotated tags require a committer identity —
`user.name` + `user.email` — and hosted GitHub runners don't set one
by default. Configure it before the piot step:

```yaml
- name: Configure git identity
  run: |
    git config --global user.name "github-actions[bot]"
    git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

The `41898282+github-actions[bot]@users.noreply.github.com` email is
[GitHub's canonical no-reply address](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address#about-commit-email-addresses)
for the `github-actions[bot]` identity. Using it means the tag attribution
shows up correctly in the GitHub UI.

If you want tags attributed to a specific user instead, substitute
any valid name + email. Committer identity does not affect OIDC
trusted publishing — it's purely for the git side.

Without this step, publish fails at tag creation with:

```
*** Please tell me who you are.
fatal: unable to auto-detect email address
```

## npm: `NODE_AUTH_TOKEN` (fallback only)

OIDC is the default path for npm too, but if you fall back to a
long-lived token, `actions/setup-node` wires the token under the env
name `NODE_AUTH_TOKEN` when `registry-url` is set:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '24'
    registry-url: 'https://registry.npmjs.org'
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

piot also accepts `NPM_TOKEN` as a fallback name — wire the secret
under whichever name you prefer, they're equivalent.

## crates.io: `cargo` + `CARGO_REGISTRY_TOKEN`

Hosted runners ship `cargo` preinstalled, so no setup step is
required. For the token, the workflow scaffolds
`CARGO_REGISTRY_TOKEN` pulled from
[`rust-lang/crates-io-auth-action@v1`](https://github.com/rust-lang/crates-io-auth-action)
when using OIDC.

If you're on a self-hosted runner without `cargo`:

```yaml
- uses: dtolnay/rust-toolchain@stable
```

## Dynamic-version Python projects

One more runner-level prereq, specific to PyPI packages using
`[project].dynamic = ["version"]`: set
`SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>` (or the maturin equivalent)
on the **build** job so the backend uses piot's planned version
instead of deriving one from git. See
[dynamic versions](/guide/dynamic-versions).

## Summary checklist

Before cutting your first release, confirm the publish job has:

- [ ] `actions/checkout@v4` with `fetch-depth: 0`.
- [ ] `actions/setup-python@v5` + `pip install twine` (if any
      `kind = "pypi"` package).
- [ ] `git config user.name` / `user.email` step.
- [ ] `actions/setup-node@v4` (for npm, or if the piot action runtime
      version matters).
- [ ] `actions/download-artifact@v4` with `path: artifacts`.
- [ ] `permissions: contents: write, id-token: write`.
- [ ] OIDC trusted publisher registered per registry (see
      [Authentication](/guide/auth)).

## Related

- [Artifact contract](/guide/artifact-contract) — what the build job
  must upload and under which names.
- [Troubleshooting publish failures](/guide/troubleshooting) — error
  strings keyed to the prereqs above.
