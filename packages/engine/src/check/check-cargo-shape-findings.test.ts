import { describe, expect, it, vi } from 'vitest';

import { checkCargoShape } from '../preflight.js';
import { checkCargoShapeFindings } from './check-cargo-shape-findings.js';
import type { CheckFinding } from './check-types.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'rs', kind: 'crates' }] as unknown as readonly Package[];

describe('checkCargoShapeFindings', () => {
  it('forwards the packages and the cwd option to the preflight', async () => {
    vi.mocked(checkCargoShape).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkCargoShapeFindings(packages, '/repo', findings);
    expect(checkCargoShape).toHaveBeenCalledWith(packages, { cwd: '/repo' });
    expect(findings).toEqual([]);
  });

  it('maps each preflight finding to `[code] path: detail`', async () => {
    vi.mocked(checkCargoShape).mockResolvedValue([
      {
        package: 'rs',
        cargoTomlPath: 'rs/Cargo.toml',
        code: 'PIOT_CRATES_NAME_MISMATCH',
        detail: '[package].name "other" does not match "rs"',
      },
    ]);
    const findings: CheckFinding[] = [];
    await checkCargoShapeFindings(packages, '/repo', findings);
    expect(findings).toEqual([
      {
        package: 'rs',
        message: '[PIOT_CRATES_NAME_MISMATCH] rs/Cargo.toml: [package].name "other" does not match "rs"',
      },
    ]);
  });
});
