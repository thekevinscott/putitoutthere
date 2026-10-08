# Friendly config error hints

**Summary.** A consumer integration produced a `putitoutthere.toml`
with four shape mistakes at once: `version = 1` declared at the
file root rather than under `[putitoutthere]`, `[[packages]]`
(plural) instead of `[[package]]` (singular), `registry =` instead
of `kind =`, and `files =` instead of `globs =`. The engine's
zod-derived error message named none of those four typos by their
correct equivalent — `Invalid input: expected object, received
undefined; ...; Unrecognized keys: "version", "packages"` is
technically correct and operationally useless. `parseConfig` now
runs a pre-pass that detects each of these four cases by inspecting
the parsed TOML before zod runs, and emits a hint that names both
the wrong key and the right one. The README's [Drop in
`putitoutthere.toml`](../README.md#2-drop-in-putitoutthere-toml)
section grew a wrong→right table covering the same four traps so
the docs and the engine speak the same vocabulary, the
[Drop in `.github/workflows/release.yml`](../README.md#1-drop-in-githubworkflowsreleaseyml)
section grew an `[!IMPORTANT]` callout warning consumers off
`push: branches: [main]` triggers on lane CI workflows, and `1b.
build-check.yml` was promoted from "Optional" to "Recommended"
because it's the cheapest pre-merge surface that exercises
`parseConfig` on the consumer's actual config.

**Required changes.** None. The hints fire only on configs that
were already failing validation; valid configs are unaffected.
A config that was failing with a confusing zod message before will
now fail with a hint message that names the fix:

| Wrong (still rejected, clearer message)                              | Right                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| `version = 1` at file root, no `[putitoutthere]` table               | `[putitoutthere]` table with `version = 1` inside |
| `[[packages]]` (plural)                                              | `[[package]]` (singular, one block per package)  |
| `registry = "crates"`                                                | `kind = "crates"`                                |
| `files = ["src/**"]`                                                 | `globs = ["src/**"]`                             |

Consumers with healthy configs can ignore this. Consumers with
broken configs whose CI was previously red against a zod message
will see the same red CI with a clearer message — fix the config
shape per the table above.

**Deprecations removed.** None.

**Behavior changes without code changes.** Error message text
on failed config validation. The exit code, the failure surface
(`parseConfig` throwing inside the engine), and the set of
configs that pass validation are all unchanged.

**Verification.** A failing config with any of the four mistakes
above will now contain the words `did you mean` in its CI log
output. Repos with valid configs see no change in any release
or build-check run.

---
