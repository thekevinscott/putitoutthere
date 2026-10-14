import { join, resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectBundleCliCrateFindings } from './collect-bundle-cli-crate-findings.js';
import type { Package } from './config.js';
import type { CargoShapeFinding } from './cargo-shape-types.js';
import { declaredFeatures } from './declared-features.js';
import { readDeclaredBinNames } from './read-declared-bin-names.js';
import { readToml } from './read-toml.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./declared-features.js');
vi.mock('./read-declared-bin-names.js');
vi.mock('./read-toml.js');

type PypiPackage = Package & { kind: 'pypi' };
type BundleCli = NonNullable<PypiPackage['bundle_cli']>;

const readTomlMock = vi.mocked(readToml);
const binsMock = vi.mocked(readDeclaredBinNames);
const featuresMock = vi.mocked(declaredFeatures);

const pkg = { name: 'py', kind: 'pypi', path: 'py' } as unknown as PypiPackage;
const manifest = { package: { name: 'my-cli' } };
const relCargoToml = join(resolve('/repo', 'crates/cli'), 'Cargo.toml');

function bundle(over: Partial<BundleCli> = {}): BundleCli {
  return {
    bin: 'my-cli',
    stage_to: 'py/bin',
    crate_path: 'crates/cli',
    features: [],
    no_default_features: false,
    ...over,
  };
}

async function collect(bundleCli: BundleCli): Promise<CargoShapeFinding[]> {
  const findings: CargoShapeFinding[] = [];
  await collectBundleCliCrateFindings(pkg, bundleCli, '/repo', findings);
  return findings;
}

beforeEach(() => {
  readTomlMock.mockReset();
  binsMock.mockReset();
  featuresMock.mockReset();
  readTomlMock.mockResolvedValue(manifest);
  binsMock.mockResolvedValue(['my-cli']);
  featuresMock.mockReturnValue(new Set(['cli']));
});

describe('collectBundleCliCrateFindings', () => {
  it('resolves a relative crate_path against cwd and adds nothing for a clean crate', async () => {
    await expect(collect(bundle({ features: ['cli'] }))).resolves.toEqual([]);
    expect(readTomlMock).toHaveBeenCalledWith(relCargoToml);
    expect(binsMock).toHaveBeenCalledWith(manifest, relCargoToml);
    expect(featuresMock).toHaveBeenCalledWith(manifest);
  });

  it('uses an absolute crate_path as-is', async () => {
    const abs = resolve('/elsewhere/cli');
    await collect(bundle({ crate_path: abs }));
    expect(readTomlMock).toHaveBeenCalledWith(join(abs, 'Cargo.toml'));
  });

  it('adds nothing when the crate manifest is missing or unparseable', async () => {
    readTomlMock.mockResolvedValue(null);
    await expect(collect(bundle({ bin: 'absent', features: ['x'] }))).resolves.toEqual([]);
    expect(binsMock).not.toHaveBeenCalled();
  });

  it('flags a bin the crate does not declare, listing the declared bins', async () => {
    binsMock.mockResolvedValue(['a', 'b']);
    await expect(collect(bundle({ bin: 'x' }))).resolves.toEqual([
      {
        package: 'py',
        cargoTomlPath: relCargoToml,
        code: 'PIOT_CRATES_MISSING_BIN',
        detail: `bundle_cli.bin = "x" is not declared as a [[bin]] in ${relCargoToml}; declared bins: a, b`,
      },
    ]);
  });

  it('says "(none)" when the crate declares no bins', async () => {
    binsMock.mockResolvedValue([]);
    const [finding] = await collect(bundle());
    expect(finding!.detail).toMatch(/; declared bins: \(none\)$/);
  });

  it('skips the feature check when bundle_cli lists no features', async () => {
    await collect(bundle());
    expect(featuresMock).not.toHaveBeenCalled();
  });

  it('flags features the crate does not declare', async () => {
    const findings: CargoShapeFinding[] = [];
    await collectBundleCliCrateFindings(pkg, bundle({ features: ['cli', 'x'] }), '/repo', findings);
    expect(findings).toEqual([
      {
        package: 'py',
        cargoTomlPath: relCargoToml,
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: 'bundle_cli.features = ["cli","x"] references undeclared feature(s) ["x"]; Cargo.toml [features] declares ["cli"]',
      },
    ]);
  });

  it('appends to the findings array it is given', async () => {
    binsMock.mockResolvedValue([]);
    const prior: CargoShapeFinding = { package: 'p', cargoTomlPath: 'x', code: 'PIOT_CRATES_MISSING_BIN', detail: 'd' };
    const findings = [prior];
    await collectBundleCliCrateFindings(pkg, bundle(), '/repo', findings);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toBe(prior);
  });
});
