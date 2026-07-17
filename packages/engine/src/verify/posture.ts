/**
 * `putitoutthere verify` — per-package publish/trust posture (#414).
 *
 * Answers "do I still need the registry token, or is OIDC trusted
 * publishing active?" For each package it reads the latest published
 * version (the same `latestVersion` `status` uses) and then that release's
 * trust attribution via the handler's `trustPosture` primitive — from
 * PUBLIC registry data, no secrets. Classifies `oidc` (trusted publisher /
 * provenance) / `token` / `unpublished` (no release) / `unreachable`.
 *
 * Shared engine, no parallel logic (design-commitments #7): a thin reader
 * over the per-kind handlers, reusing the exact registry-name resolution
 * the publish path runs. The read degrades — an unreachable registry
 * yields `unreachable`, never an abort — matching `status`.
 */

import { join } from 'node:path';

import { loadConfig } from '../config.js';
import { handlerFor } from '../handlers/index.js';
import { createLogger } from '../log.js';
import type { Ctx } from '../types.js';
import type { Posture, VerifyOptions, VerifyRow } from './posture-types.js';

export async function computeVerify(opts: VerifyOptions): Promise<VerifyRow[]> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const config = await loadConfig(cfgPath);
  const ctx: Ctx = {
    cwd,
    log: createLogger(),
    env: process.env as Record<string, string>,
    artifacts: { get: () => '', has: () => false },
  };

  const rows: VerifyRow[] = [];
  for (const pkg of config.packages) {
    const handler = handlerFor(pkg.kind);
    let version: string | null = null;
    let posture: Posture;
    try {
      version = await handler.latestVersion(pkg, ctx);
      // No release to attribute; otherwise read the trust posture of the
      // latest published version.
      posture = version === null ? 'unpublished' : await handler.trustPosture(pkg, version, ctx);
    } catch {
      // 5xx / network / timeout on either read: report unreachable rather
      // than guess a posture.
      posture = 'unreachable';
    }
    rows.push({ package: pkg.name, kind: pkg.kind, version, posture });
  }
  return rows;
}
