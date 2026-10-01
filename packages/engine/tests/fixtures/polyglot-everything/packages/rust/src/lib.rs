/// The core's own compile-time version.
///
/// `CARGO_PKG_VERSION` is baked in per crate at compile time from that
/// crate's on-disk `[package].version`, with no env override — the shape
/// clap's `#[command(version)]` expands to, in the crate where the attribute
/// is written. That is exactly why a release has to rewrite the manifest
/// before the build, and why an artifact that embeds this crate reports THIS
/// value rather than its own. #641.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
