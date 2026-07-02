import { describe, expect, it } from 'vitest';

import { replaceWorkspacePackageVersion } from './replace-workspace-package-version.js';

describe('replaceWorkspacePackageVersion (#428)', () => {
  const src = [
    '[workspace]',
    'members = ["a"]',
    '',
    '[workspace.package]',
    'version = "0.1.0"',
    'edition = "2021"',
    '',
  ].join('\n');

  it('rewrites [workspace.package].version, leaving the rest byte-for-byte', () => {
    const out = replaceWorkspacePackageVersion(src, '0.2.0');
    expect(out).toBe(src.replace('0.1.0', '0.2.0'));
    // The [workspace] table above it and sibling keys are untouched.
    expect(out).toContain('[workspace]');
    expect(out).toContain('edition = "2021"');
  });

  it('is a no-op when the version already matches', () => {
    expect(replaceWorkspacePackageVersion(src, '0.1.0')).toBe(src);
  });

  it('throws when [workspace.package] carries no version', () => {
    const noVersion = ['[workspace.package]', 'edition = "2021"', ''].join('\n');
    expect(() => replaceWorkspacePackageVersion(noVersion, '0.2.0')).toThrow(
      /no \[workspace\.package\]\.version/,
    );
  });
});
