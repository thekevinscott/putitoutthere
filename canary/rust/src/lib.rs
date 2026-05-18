//! Live canary against real crates.io — see canary/putitoutthere.toml.
//! The post-publish verify step in .github/workflows/canary.yml depends
//! on `piot-canary` from a tmp `Cargo.toml` and asserts cargo resolves
//! the version the engine just shipped.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn canary() -> bool {
    true
}
