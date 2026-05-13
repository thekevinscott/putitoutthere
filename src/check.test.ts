/**
 * Unit tests for `runChecks`.
 *
 * The behavioural contract for the check set is exercised in
 * `test/integration/check.integration.test.ts` — that's the tier
 * issue #319's acceptance criteria call out (unit tests with mocked
 * handlers cannot observe the integration the checks exist to
 * prevent). These cases cover only the cheap branches the
 * integration suite doesn't repeat: missing config file at the
 * resolved path, and parse failures short-circuiting before any
 * downstream check runs.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChecks } from './check.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'piot-check-unit-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('runChecks: short-circuit branches', () => {
  it('returns one finding pointing at the resolved config path when the file is missing', () => {
    const findings = runChecks({ cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/putitoutthere\.toml not found/);
    expect(findings[0]!.message).toContain(cwd);
    expect(findings[0]!.package).toBeUndefined();
  });

  it('surfaces parseConfig errors and stops before downstream checks', () => {
    // Malformed TOML: bare key with no `=`. parseConfig throws; we
    // capture it as a single finding and exit before the per-package
    // pass runs, so no `package = '?'` finding leaks through.
    writeFileSync(join(cwd, 'putitoutthere.toml'), 'this is not toml');
    const findings = runChecks({ cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.package).toBeUndefined();
  });

  it('honors --config override', () => {
    const altPath = join(cwd, 'alt.toml');
    const findings = runChecks({ cwd, configPath: altPath });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('alt.toml');
  });
});
