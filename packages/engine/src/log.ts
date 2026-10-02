/**
 * Structured logger (#11). JSON-per-line in CI, text in TTYs. Redaction is
 * substring-based, not field-path based, since handlers pipe child-process
 * output through here: secret-shaped env values (from `process.env` plus any
 * `envSources` given to `createLogger`, #136) become `[REDACTED:<digest>]`, a
 * stable 8-hex SHA-256 prefix (#134). Values under 8 chars are skipped —
 * mangling `CI=1` costs more than it protects (#137).
 */

import { createHash } from 'node:crypto';
import type { Writable } from 'node:stream';

import type { Logger } from './types.js';

export type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type EnvSource = Record<string, string | undefined>;

export interface LoggerOptions {
  stream?: Writable;
  pretty?: boolean; // default: detect by stream.isTTY if available, else false
  level?: Level;    // default: 'info'
  /**
   * Additional env-like objects to scan for secrets, alongside
   * `process.env`. Credentials are frequently injected into `ctx.env`
   * rather than the process env (#136), so callers can pass `ctx.env`
   * here to make the redactor see them.
   */
  envSources?: readonly EnvSource[];
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  // Default to stderr so stdout stays clean for machine-readable
  // output from `plan --json` and `publish --json`.
  const stream: Writable = opts.stream ?? process.stderr;
  const pretty = opts.pretty ?? isTty(stream);
  const minLevel = LEVEL_ORDER[opts.level ?? 'info'];
  const sources: readonly EnvSource[] = [
    process.env,
    ...(opts.envSources ?? []),
  ];

  const emit = (level: Level, msg: string, fields: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minLevel) {return;}
    const record = { level, time: new Date().toISOString(), msg, ...fields };
    const raw = pretty ? formatPretty(record) : `${JSON.stringify(record)}\n`;
    stream.write(redact(raw, sources));
  };

  return {
    debug: (msg, fields = {}) => emit('debug', msg, fields),
    info: (msg, fields = {}) => emit('info', msg, fields),
    warn: (msg, fields = {}) => emit('warn', msg, fields),
    error: (msg, fields = {}) => emit('error', msg, fields),
  };
}

function isTty(stream: Writable): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}

function formatPretty(record: Record<string, unknown>): string {
  const { level, time: _t, msg, ...fields } = record;
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${formatScalar(v)}`)
    .join(' ');
  const prefix = `[${String(level).toUpperCase()}]`;
  return pairs.length > 0 ? `${prefix} ${String(msg)}  ${pairs}\n` : `${prefix} ${String(msg)}\n`;
}

function formatScalar(v: unknown): string {
  if (typeof v === 'string') {return v;}
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) {return String(v);}
  return JSON.stringify(v);
}

/* ----------------------------- redaction ----------------------------- */

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

function scanSource(src: EnvSource): readonly string[] {
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

/**
 * Replace every occurrence of a known-secret env value with
 * `[REDACTED:<digest>]` where `<digest>` is a stable 8-hex-char
 * SHA-256 prefix of the token. Operators can correlate rotated
 * tokens across log lines without ever seeing the value itself.
 *
 * Sources default to `[process.env]`. Callers (e.g. `createLogger`)
 * pass additional per-ctx env objects so credentials that never touched
 * `process.env` still redact (#136).
 */
export function redact(
  s: string,
  sources: readonly EnvSource[] = [process.env],
): string {
  let out = s;
  for (const src of sources) {
    for (const v of scanSource(src)) {
      if (!out.includes(v)) {continue;}
      // String.replaceAll expects a literal or a RegExp; use split/join to
      // avoid regex escaping every secret value. Repeats across sources
      // are a no-op (the value's already gone after the first pass).
      out = out.split(v).join(`[REDACTED:${sha256Prefix(v)}]`);
    }
  }
  return out;
}

/** SHA-256 prefix for identifying a token in logs without leaking it.
 * Inlined here after removing `auth.ts#tokenDigest` (#134): the redactor
 * was the only external consumer, and exposing the helper just for one
 * call site is the kind of indirection we don't need. */
function sha256Prefix(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}
