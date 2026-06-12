# Trusted publishers & the first-publish bootstrap

This is the part of a first release that most often goes sideways, because
the rules differ per registry. Read the registry section that applies, do the
external setup, then return to the skill.

## The one thing to internalize

OIDC **trusted publishing (TP)** is the goal on all three registries: no
long-lived tokens, the registry verifies the artifact was built by your
workflow. But TP on crates.io and npm **binds to an already-published
package** — so the *very first* publish of a brand-new crate or npm package
has no OIDC path. PyPI is the exception: it supports a *pending* publisher you
can register before the package exists.

So the first release is a bootstrap:

| Registry | First publish | Every publish after |
|----------|---------------|---------------------|
| **PyPI** | Pending publisher → **no token** | Same TP, zero secrets |
| **crates.io** | One-time `CARGO_REGISTRY_TOKEN` secret (or a local `cargo publish`) | TP, zero secrets |
| **npm** | One-time `NPM_TOKEN` secret | TP, zero secrets |

A bootstrap token is a **one-time** crutch. The post-publish step (drop the
secret, register the TP against the now-existing package) is not optional — it
is what gets you to the secure steady state.

## Register against YOUR repo

For all three registries the TP fields are the same:

- **Repository owner / name** — *your* repo, the one running `release.yml`.
  **Not** `thekevinscott/putitoutthere`. The reusable workflow runs inside
  your release path, so the OIDC claims line up with your repo.
- **Workflow filename** — `release.yml` (the caller workflow filename, exactly
  as committed). Do not rename it later: TP records encode this filename and
  renaming silently invalidates trust.
- **Environment** — only if you set a GitHub deployment environment (optional).

## Secrets safety (applies to every bootstrap token)

- Tokens go into **GitHub repository secrets** (Settings → Secrets and
  variables → Actions), or environment secrets if you use a release
  environment. Never commit a token, never paste one into chat, never write
  one into a file in the repo.
- The skill should walk the user to the GitHub secrets UI and have *them*
  paste the value. The agent never handles the token itself.

---

## PyPI — the clean path (no token)

PyPI supports a **pending publisher**, so you never need a bootstrap token.

1. Go to <https://pypi.org/manage/account/publishing/> and add a **pending**
   GitHub publisher (works even though the project does not exist yet):
   - PyPI project name (the `[project].name`, or the `pypi` override)
   - Your repo owner + name
   - Workflow filename: `release.yml`
   - Environment (optional)
   - Docs: <https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/>
2. That's it for setup. The first publish mints the project and converts the
   pending publisher into a normal one.

> The `release.yml` template already carries the `pypi-publish` job that runs
> `pypa/gh-action-pypi-publish` **in your workflow context**. That is required
> — PyPI filters OIDC tokens by repo owner/name before checking the workflow,
> so the upload cannot run from inside putitoutthere's reusable workflow. Leave
> that job in place; it self-skips for repos that don't publish to PyPI.

If a project already exists, register the publisher from its page instead:
`https://pypi.org/manage/project/<name>/settings/publishing/`.

---

## crates.io — bootstrap then bind

TP binds to an existing crate, so the first `cargo publish` needs a token.
Pick **one** bootstrap route:

**Route A — bootstrap through the workflow (recommended, stays in CI).**

1. Create a crates.io API token (Account Settings → API Tokens), scoped to
   publish-new-crates.
2. Add it as the repo secret `CARGO_REGISTRY_TOKEN`.
3. Wire the secret into the call site for the first run only:

   ```yaml
   jobs:
     release:
       uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
       secrets:
         CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
   ```

   When the secret is set, the OIDC step is skipped and the token is used.

**Route B — publish once locally.** Run `cargo publish` from your machine with
your account token to create the crate, then skip straight to step 1 below.

Then, after the crate exists:

1. Go to `https://crates.io/crates/<crate>/settings` → **Trusted Publishing**
   → **Add**.
2. Fill in your repo owner, repo name, `release.yml`, environment (optional).
3. **Post-publish cleanup:** remove the `secrets:` block and delete the
   `CARGO_REGISTRY_TOKEN` secret. Subsequent publishes are zero-secret OIDC.

> If a crates.io publish 404s with `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED`,
> that is exactly this case: the crate has never been published and TP has
> nothing to bind to. Bootstrap with a token (Route A or B).

---

## npm — bootstrap, then one TP per published package

TP binds to an existing package, so the first `npm publish` needs a token.

1. Create an npm **automation** token (npmjs.com → Access Tokens → Generate →
   Automation).
2. Add it as the repo secret `NPM_TOKEN`.
3. Wire it into the call site for the first run only:

   ```yaml
   jobs:
     release:
       uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
       secrets:
         NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```

   The token is exported as `NODE_AUTH_TOKEN`; the npm CLI prefers it over
   OIDC. For `bundled-cli` / `napi` families, this one token authenticates the
   first publish of **all** per-platform sub-packages.

Then, after the package(s) exist:

1. Go to `https://www.npmjs.com/package/<name>/access` → **Require trusted
   publisher**.
2. Fill in your repository, `release.yml`, environment (optional).
3. **Repeat for every per-platform sub-package.** A TP on `my-cli` does not
   cover `my-cli-x86_64-unknown-linux-gnu`. A bundled-cli/napi family with N
   targets needs N+1 TP registrations (one per platform package plus the
   top-level). Multi-mode families need one per platform package across
   *every* mode.
4. **Post-publish cleanup:** remove the `secrets:` block and delete the
   `NPM_TOKEN` secret once every package has its TP. Subsequent publishes are
   zero-secret OIDC.

---

## When auth is wired wrong

`PIOT_AUTH_NO_TOKEN` at publish time means neither an OIDC-minted token nor a
caller-provided token was resolved. Usual causes: the TP exchange failed
silently (registration mismatch — wrong repo, wrong workflow filename, wrong
environment), or the bootstrap secret was referenced but empty. Re-check the TP
record's repo/owner/workflow fields against the values above.
