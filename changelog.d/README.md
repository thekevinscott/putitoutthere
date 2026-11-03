# Changelog fragments

One file per PR, added in that PR. This folder *is* the changelog. No
rendered CHANGELOG is assembled from it, nothing commits back to `main` at
release, and fragments are never deleted, rewritten, or flushed: they
accumulate as the permanent record. Entries released before #730 stay in
[`../CHANGELOG.md`](../CHANGELOG.md).

- **Filename:** `YYYY-MM-DD-engine-<slug>.md`. The date is the UTC *merge*
  date (not author date; authored timestamps interleave wrongly across
  long-lived branches). `engine` is the package directory
  (`packages/engine`); testing-conventions requires that segment for a
  pooled fragment folder (#820). The slug is short, lowercase letters,
  digits, and hyphens. Plain `ls` sorts chronologically. Fragments from
  before #820 have no package segment and stay as they are.
- **Body:** one or more `- ` bullets. Lead each with the Keep a Changelog
  category (`Added:` / `Changed:` / `Deprecated:` / `Removed:` / `Fixed:`).
  Breaking changes carry a `**BREAKING**` marker and link to their
  [`../migrations.d/`](../migrations.d/) fragment.
- **Evidence:** every bullet ends in a `(verified by: ...)` or
  `(no fixture: ...)` clause. See
  [`AGENTS.md`](../AGENTS.md#verification-policy).
- **Version attribution:** fragments carry dates, not versions. To answer
  "which release shipped X", map the fragment's date against tags:
  `git log --tags --simplify-by-decoration --format='%cI %d'`.

Enforced by `changelog-check.yml`: a PR that changes public surface must
add a fragment here and one in [`../migrations.d/`](../migrations.d/), and
every added fragment must follow the filename rule. `evidence-check.yml`
checks the evidence clauses. Bypass the fragment requirement with a
`skip-changelog:` git trailer for changes with no consumer impact.
