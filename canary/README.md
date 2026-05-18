# Live canary

Two throwaway packages that the weekly
[`canary.yml`](../.github/workflows/canary.yml) workflow re-publishes
to **real registries** so we catch regressions in
`putitoutthere`'s interaction with live-registry behavior that the
per-PR Verdaccio + cargo-http-registry mocks lag behind on.

Tracking issue: [#297](https://github.com/thekevinscott/putitoutthere/issues/297).
Parent program: [#292](https://github.com/thekevinscott/putitoutthere/issues/292).

| Registry | Package | Notes |
| --- | --- | --- |
| npm | [`@putitoutthere/piot-canary`](https://www.npmjs.com/package/@putitoutthere/piot-canary) | Reuses the `@putitoutthere` org that hosts the per-PR `piot-fixture-zzz-*` family. Published under the `canary` dist-tag so the timestamp versions never touch `latest`. |
| crates.io | [`piot-canary`](https://crates.io/crates/piot-canary) | Library crate; crates.io is flat-namespaced, so unscoped. The post-publish verify step `cargo add`s it into a tmp `Cargo.toml`. |

Each weekly run rewrites `__VERSION__` to `0.0.${unix_seconds}` so
crates.io's immutable-publish rule never collides. The npm package
honors the `canary` dist-tag for the same reason.

This is internal infrastructure. Do not link from `README.md`; do not
treat as a consumer-facing example.

See [`notes/internals/canary.md`](../notes/internals/canary.md) for
operational notes (Trusted Publisher records, bootstrap, on-failure
playbook).
