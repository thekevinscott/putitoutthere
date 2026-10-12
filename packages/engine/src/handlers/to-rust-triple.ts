/**
 * napi-rs short form → Rust target triple. npm `targets` are written in
 * napi-rs short form (`linux-x64-gnu`); the bundled-cli cross-compile path
 * feeds the triple to `rustup target add` / `cargo build --target`, which
 * only understand Rust triples (`x86_64-unknown-linux-gnu`). This is the
 * napi→rust half of the correspondence `TRIPLE_MAP` already encodes for
 * os/cpu — every napi key in `TRIPLE_MAP` has an entry here, so a triple
 * that passes `assertTripleSupported` always resolves.
 *
 * Issue #387.
 */
const NAPI_TO_RUST: Record<string, string> = {
  'linux-x64-gnu': 'x86_64-unknown-linux-gnu',
  'linux-x64-musl': 'x86_64-unknown-linux-musl',
  'linux-arm64-gnu': 'aarch64-unknown-linux-gnu',
  'linux-arm64-musl': 'aarch64-unknown-linux-musl',
  'linux-arm-gnueabihf': 'armv7-unknown-linux-gnueabihf',
  'linux-arm-musleabihf': 'armv7-unknown-linux-musleabihf',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64-msvc': 'x86_64-pc-windows-msvc',
  'win32-arm64-msvc': 'aarch64-pc-windows-msvc',
};

/** The Rust triples the map can produce. A consumer who declares
 *  rust-flavor `targets` (the pypi convention, also accepted on npm) gets
 *  identity passthrough — the triple is already what rustup/cargo want. */
const RUST_TRIPLES: ReadonlySet<string> = new Set(Object.values(NAPI_TO_RUST));

/**
 * Resolve a target triple to its Rust (rustup/cargo) form: a napi-rs short
 * form (`linux-x64-gnu`) maps to its Rust triple, a Rust triple is identity,
 * and anything else throws so an unmappable triple fails at plan time rather
 * than reaching `rustup target add` (#387). Case-insensitive.
 */
export function toRustTriple(target: string): string {
  const key = target.toLowerCase();
  const mapped = NAPI_TO_RUST[key];
  if (mapped !== undefined) {
    return mapped;
  }
  if (RUST_TRIPLES.has(key)) {
    return key;
  }
  throw new Error(
    `Target triple "${target}" has no known Rust-triple mapping. ` +
      `Add it to NAPI_TO_RUST in src/handlers/to-rust-triple.ts.`,
  );
}
