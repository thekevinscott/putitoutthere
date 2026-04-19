# Migrating gbnf to putitoutthere

Audit draft. gbnf is a GBNF grammar library — likely polyglot (TS + Python bindings, possibly Rust core). Full audit requires cloning and reading the repo.

---

## TL;DR

| Before (gbnf) | After (putitoutthere) |
|---|---|
| <TODO: current workflows> | 2 workflows |
| <TODO: polyglot — one release cascade across all lang bindings?> | `putitoutthere`'s cross-language `depends_on` cascade |
| <TODO: release signal> | `release: <bump>` git trailer |

---

## Behavior changes to accept

1. **Cross-language cascade.** If gbnf's Rust core ships with Python + JS wrappers, a change to the Rust crate should trigger wrapper releases. Declare `depends_on = ["gbnf-rust"]` on the wrapper packages in `putitoutthere.toml`.
2. **TODO:** verify wheel/native-module shape. If Python wraps via maturin, use `build = "maturin"` with the 5-target matrix. If JS wraps via napi, use `build = "napi"`.

---

## Target `putitoutthere.toml`

```toml
[putitoutthere]
version = 1

[[package]]
name = "gbnf-rust"
kind = "crates"
path = "crates/gbnf"  # TODO confirm
paths = ["crates/gbnf/**"]

# [[package]]  TODO if Python binding exists
# name = "gbnf-python"
# kind = "pypi"
# build = "maturin"
# targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin", ...]
# depends_on = ["gbnf-rust"]

# [[package]]  TODO if JS binding exists
# name = "gbnf-js"
# kind = "npm"
# build = "napi"  # or bundled-cli
# targets = [...]
# depends_on = ["gbnf-rust"]
```

---

## Target `release.yml`

Use `putitoutthere init` output. The `build` job matrix steps for `crates`, `pypi` (maturin), and `npm` (napi/bundled-cli) are all in the scaffolded template.

---

## Files to delete after migration

<TODO>

---

## Verification checklist

- [ ] `cargo add gbnf` resolves to the new crate version.
- [ ] `pip install gbnf` resolves wheels for all declared targets.
- [ ] `npm i gbnf` resolves the right platform package.
- [ ] Cascade fires across all three bindings on a Rust-core change.

---

## Plan gaps surfaced

- [ ] **Potential:** wheel-tag → platform-package-os/cpu mismatch. putitoutthere's `targetToOsCpu` covers the common napi-rs triples; if gbnf uses unusual target names (e.g. `i686-*`), verify the mapping or add entries.
