# pnpm on release runners moves from 9 to 11

**Summary.** Every runner step that installed pnpm for a consumer repo
ran `npm install -g pnpm@9`; it now installs `pnpm@11`. Two pnpm 9
behaviors motivated the move, and neither reproduces on a modern local
pnpm — both first appeared inside a release run. pnpm 9 aborts with
`packages field missing or empty` when a `pnpm-workspace.yaml` exists
without a `packages:` key, and it ran dependency build scripts
unconditionally where pnpm 10+ blocks any not explicitly allowlisted.

There is deliberately **no input to override the version.** A single
current default is the "as little configuration as possible" commitment,
and neither pnpm 9 behavior is something a consumer should be opting
into.

**Required changes.** None if your repo has no `pnpm-lock.yaml` — the
npm / `package-lock.json` path is untouched. If you do use pnpm, check
one thing: the build-script allowlist. pnpm 9 ran dependency build
scripts unconditionally; pnpm 10+ blocks any not allowlisted.

```yaml
# pnpm-workspace.yaml — needed on pnpm 10+ for any dependency that
# compiles or downloads a binary at install time.
packages:
  - 'packages/*'
allowBuilds:
  esbuild: true
```

The key is major-specific: `pnpm.onlyBuiltDependencies` in
`package.json` on 9, `onlyBuiltDependencies` in `pnpm-workspace.yaml`
on 10, `allowBuilds` on 11. If you were spelling it several ways at
once to survive whichever major ran, you can now keep only the pnpm 11
form.

Grant the narrowest set that works. A package is worth allowlisting
only if something you actually run needs what its script produces —
`esbuild` installs a native binary `tsx` depends on, whereas a mocking
library whose postinstall stages a *browser* service worker needs
nothing when you only import its Node entry point.

**Deprecations removed.** None.

**Behavior changes without code changes.** Consumers with a
`pnpm-lock.yaml` get pnpm 11 instead of pnpm 9 on plan, build, and
publish runners. A dependency whose build script is not allowlisted is
skipped rather than run. pnpm reports this as `Ignored build scripts: …`
at install time, but the downstream symptom is usually a missing binary
at run time, well after the install that caused it.

**Verification.** Look for `Packages: +N` under a `pnpm@11` install in
the build job log, and confirm no `Ignored build scripts:` line names a
package you need.

---
