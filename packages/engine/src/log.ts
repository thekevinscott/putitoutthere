/**
 * Structured logger (#11). JSON-per-line in CI, text in TTYs. Redaction is
 * substring-based, not field-path based, since handlers pipe child-process
 * output through here: secret-shaped env values (from `process.env` plus any
 * `envSources` given to `createLogger`, #136) become `[REDACTED:<digest>]`, a
 * stable 8-hex SHA-256 prefix (#134). Values under 8 chars are skipped —
 * mangling `CI=1` costs more than it protects (#137).
 */

import type { Writable } from 'node:stream';

import { redact } from './redact.js';
import type { EnvSource } from './scan-source.js';
import type { Logger } from './types.js';

export type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

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
