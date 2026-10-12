import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectCratesPackageFindings } from './collect-crates-package-findings.js';
import type { Package } from './config.js';
import {
  declaredFeatures,
  versionInheritsWorkspace,
  workspaceVersionDeclared,
  type CargoShapeFinding,
} from './preflight.js';
import { readToml } from './read-toml.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./preflight.js');
vi.mock('./read-toml.js');

const readTomlMock = vi.mocked(readToml);
const declaredFeaturesMock = vi.mocked(declaredFeatures);
const inheritsMock = vi.mocked(versionInheritsWorkspace);
const wsDeclaredMock = vi.mocked(workspaceVersionDeclared);

const cargoTomlPath = join('/repo/crate', 'Cargo.toml');

function crate(over: Partial<Package & { kind: 'crates' }> = {}): Package & { kind: 'crates' } {
  return {
    name: 'widget',
    kind: 'crates',
    path: '/repo/crate',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
    ...over,
  };
}

async function collect(p: Package & { kind: 'crates' }, cwd = '/repo'): Promise<CargoShapeFinding[]> {
  const findings: CargoShapeFinding[] = [];
  await collectCratesPackageFindings(p, cwd, findings);
  return findings;
}

beforeEach(() => {
  readTomlMock.mockReset();
  declaredFeaturesMock.mockReset();
  inheritsMock.mockReset();
  wsDeclaredMock.mockReset();
  declaredFeaturesMock.mockReturnValue(new Set());
  inheritsMock.mockReturnValue(false);
  wsDeclaredMock.mockResolvedValue(true);
});

describe('collectCratesPackageFindings', () => {
  it('reads Cargo.toml under the package path and adds nothing when it is missing or unparseable', async () => {
    readTomlMock.mockResolvedValue(null);
    await expect(collect(crate({ features: ['x'] }))).resolves.toEqual([]);
    expect(readTomlMock).toHaveBeenCalledWith(cargoTomlPath);
    expect(declaredFeaturesMock).not.toHaveBeenCalled();
    expect(inheritsMock).not.toHaveBeenCalled();
  });

  it('appends to the findings array it is given', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'other' } });
    const prior: CargoShapeFinding = { package: 'p', cargoTomlPath: 'x', code: 'PIOT_CRATES_MISSING_BIN', detail: 'd' };
    const findings = [prior];
    await collectCratesPackageFindings(crate(), '/repo', findings);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toBe(prior);
  });

  it('flags a [package].name that differs from the configured name', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'other' } });
    await expect(collect(crate())).resolves.toEqual([
      {
        package: 'widget',
        cargoTomlPath,
        code: 'PIOT_CRATES_NAME_MISMATCH',
        detail: '[package].name = "other" but configured name is "widget"',
      },
    ]);
  });

  it('compares against `crate` when configured, over the package name', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'widget' } });
    const findings = await collect(crate({ crate: 'widget-rs' }));
    expect(findings.map((f) => f.detail)).toEqual([
      '[package].name = "widget" but configured name is "widget-rs"',
    ]);
    readTomlMock.mockResolvedValue({ package: { name: 'widget-rs' } });
    await expect(collect(crate({ crate: 'widget-rs' }))).resolves.toEqual([]);
  });

  it('skips the name check when [package].name is absent or not a string', async () => {
    readTomlMock.mockResolvedValue({});
    await expect(collect(crate())).resolves.toEqual([]);
    readTomlMock.mockResolvedValue({ package: { name: 1 } });
    await expect(collect(crate())).resolves.toEqual([]);
  });

  it('flags configured features the manifest does not declare', async () => {
    const parsed = { package: { name: 'widget' }, features: { a: [] } };
    readTomlMock.mockResolvedValue(parsed);
    declaredFeaturesMock.mockReturnValue(new Set(['a']));
    await expect(collect(crate({ features: ['a', 'b'] }))).resolves.toEqual([
      {
        package: 'widget',
        cargoTomlPath,
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: 'features = ["a","b"] references undeclared feature(s) ["b"]; Cargo.toml [features] declares ["a"]',
      },
    ]);
    expect(declaredFeaturesMock).toHaveBeenCalledWith(parsed);
  });

  it('adds nothing when every configured feature is declared', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'widget' } });
    declaredFeaturesMock.mockReturnValue(new Set(['a', 'b']));
    await expect(collect(crate({ features: ['a', 'b'] }))).resolves.toEqual([]);
  });

  it('skips the feature check when features is unset or empty', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'widget' } });
    await collect(crate());
    await collect(crate({ features: [] }));
    expect(declaredFeaturesMock).not.toHaveBeenCalled();
  });

  it('flags a workspace-inherited version when no ancestor declares one, walking from cwd', async () => {
    const version = { workspace: true };
    readTomlMock.mockResolvedValue({ package: { name: 'widget', version } });
    inheritsMock.mockReturnValue(true);
    wsDeclaredMock.mockResolvedValue(false);
    await expect(collect(crate(), '/root')).resolves.toEqual([
      {
        package: 'widget',
        cargoTomlPath,
        code: 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH',
        detail: '[package].version.workspace = true but no ancestor Cargo.toml declares [workspace.package].version',
      },
    ]);
    expect(inheritsMock).toHaveBeenCalledWith(version);
    expect(wsDeclaredMock).toHaveBeenCalledWith(cargoTomlPath, '/root');
  });

  it('adds nothing when the workspace declares the inherited version', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'widget', version: { workspace: true } } });
    inheritsMock.mockReturnValue(true);
    wsDeclaredMock.mockResolvedValue(true);
    await expect(collect(crate())).resolves.toEqual([]);
  });

  it('does not walk for the workspace version when the version is not inherited', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'widget', version: '1.0.0' } });
    await expect(collect(crate())).resolves.toEqual([]);
    expect(wsDeclaredMock).not.toHaveBeenCalled();
  });

  it('reports every applicable finding in name, feature, workspace order', async () => {
    readTomlMock.mockResolvedValue({ package: { name: 'other', version: { workspace: true } } });
    inheritsMock.mockReturnValue(true);
    wsDeclaredMock.mockResolvedValue(false);
    const findings = await collect(crate({ features: ['x'] }));
    expect(findings.map((f) => f.code)).toEqual([
      'PIOT_CRATES_NAME_MISMATCH',
      'PIOT_CRATES_FEATURE_NOT_DECLARED',
      'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH',
    ]);
  });
});
