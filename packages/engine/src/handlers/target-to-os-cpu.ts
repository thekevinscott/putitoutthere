import { TRIPLE_MAP, type OsCpu } from './npm-platform.js';
import { unmappedTripleMessage } from './unmapped-triple-message.js';

/**
 * Maps a napi-rs or Rust target triple to npm `os`/`cpu`/`libc` fields.
 *
 * Lookup is exact (case-insensitive). Unmapped triples throw so broken
 * platform packages — which would otherwise publish with empty `os`/
 * `cpu` filters and install everywhere — never reach the registry.
 */
export function targetToOsCpu(target: string): OsCpu {
  const entry = TRIPLE_MAP[target.toLowerCase()];
  if (!entry) {
    throw new Error(unmappedTripleMessage(target));
  }
  return entry.libc !== undefined
    ? { os: entry.os, cpu: entry.cpu, libc: entry.libc }
    : { os: entry.os, cpu: entry.cpu };
}
