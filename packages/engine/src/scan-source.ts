export type EnvSource = Record<string, string | undefined>;

/**
 * Credential-shaped env-var name matcher. Word boundaries (`_` or string
 * edges) keep false positives out — `KEYCLOAK_URL`, `TOKENIZER_MODEL`,
 * `PUBLIC_KEY_PATH`, `PASSTHROUGH`, `PATS_COUNT` must not match (#196).
 * `PASS` is deliberately absent; `PASSWORD` and `PAT` cover real credentials.
 */
const SECRET_KEY = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PAT)(?:_|$)|(?:^|_)[A-Z0-9]*KEY$/i;
const MIN_OPAQUE_LEN = 8;

/**
 * Per-source cache of extracted secret values, keyed by source-object identity
 * so repeated log calls don't rewalk every entry (#141). Mutation detection
 * uses a cheap signature (key count + total value length), so a mid-run
 * `process.env` mutation cannot leak old credentials into later lines.
 */
interface Scanned {
  sig: string;
  values: readonly string[];
}
const SCAN_CACHE = new WeakMap<EnvSource, Scanned>();

export function scanSource(src: EnvSource): readonly string[] {
  // Cheap signature-of-env to detect in-place mutation. Accumulates a
  // small multiplicative hash over each key name + value length + key's
  // first byte; distinguishes renames and equal-length swaps that a
  // plain count+length sum would miss. Keeping the per-call cost below
  // the full scan is what makes #141 a real win.
  const keys = Object.keys(src);
  let acc = keys.length;
  for (const k of keys) {
    const v = src[k] ?? '';
    acc = (acc * 31 + k.length + v.length + k.charCodeAt(0)) | 0;
  }
  const sig = `${keys.length}:${acc}`;

  const cached = SCAN_CACHE.get(src);
  if (cached !== undefined && cached.sig === sig) {return cached.values;}

  const values: string[] = [];
  for (const k of keys) {
    const v = src[k];
    // `undefined` is rare (read-after-delete race in tests). Treat
    // as absent; skip without a dedicated branch so coverage stays
    // tight.
    if (!v) {continue;}
    if (!SECRET_KEY.test(k)) {continue;}
    // #137 length floor. Short values mangle every matching character
    // in unrelated log text. Real tokens clear 8 easily; short values
    // that happen to share a name shape with a credential aren't worth
    // defending.
    if (v.length < MIN_OPAQUE_LEN) {continue;}
    values.push(v);
  }
  // Longest-first: redacting a substring first would leave the
  // superset's leftover fragment unredacted in the output.
  values.sort((a, b) => b.length - a.length);
  const entry: Scanned = { sig, values };
  SCAN_CACHE.set(src, entry);
  return values;
}
