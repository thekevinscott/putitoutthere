/**
 * Tracks which handlers are still scaffold stubs. As #16–#19 land,
 * each handler graduates out of this file into its own test suite
 * (e.g., crates.test.ts). Stubs throw a "not implemented" error
 * pointing at the follow-up issue.
 */

import { describe, expect, it } from 'vitest';
import { npm } from './npm.js';
import { pypi } from './pypi.js';
import type { Ctx, Handler, PackageConfig } from '../types.js';

const PKG: PackageConfig = {
  name: 'fixture',
  kind: 'crates',
  path: '.',
  paths: ['**/*'],
};

const CTX: Ctx = {
  cwd: '.',
  dryRun: true,
  log: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  env: {},
  artifacts: {
    get: () => '',
    has: () => false,
  },
};

describe.each([
  ['pypi', pypi, /#17/],
  ['npm', npm, /#18 \/ #19/],
] as const)('%s stub', (_name, handler: Handler, expectedIssue) => {
  it('isPublished throws a not-implemented error pointing at the follow-up issue', () => {
    expect(() => handler.isPublished(PKG, '0.1.0', CTX)).toThrow(expectedIssue);
  });
  it('writeVersion throws a not-implemented error pointing at the follow-up issue', () => {
    expect(() => handler.writeVersion(PKG, '0.1.0', CTX)).toThrow(expectedIssue);
  });
  it('publish throws a not-implemented error pointing at the follow-up issue', () => {
    expect(() => handler.publish(PKG, '0.1.0', CTX)).toThrow(expectedIssue);
  });
});
