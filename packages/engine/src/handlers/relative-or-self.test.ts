import { relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { relativeOrSelf } from './relative-or-self.js';

vi.mock('node:path');

const relativeMock = vi.mocked(relative);

afterEach(() => {
  relativeMock.mockReset();
});

describe('relativeOrSelf', () => {
  it('returns the relative path when base and target differ', () => {
    relativeMock.mockReturnValue('crate/Cargo.toml');
    expect(relativeOrSelf('/repo', '/repo/crate/Cargo.toml')).toBe('crate/Cargo.toml');
    expect(relativeMock).toHaveBeenCalledWith('/repo', '/repo/crate/Cargo.toml');
  });

  it('returns the target verbatim when base equals target (relative is empty)', () => {
    relativeMock.mockReturnValue('');
    expect(relativeOrSelf('/repo/crate/Cargo.toml', '/repo/crate/Cargo.toml')).toBe(
      '/repo/crate/Cargo.toml',
    );
  });

  it('normalises backslashes in the relative path to forward slashes', () => {
    relativeMock.mockReturnValue('nested\\crate\\Cargo.toml');
    expect(relativeOrSelf('C:\\repo', 'C:\\repo\\nested\\crate\\Cargo.toml')).toBe(
      'nested/crate/Cargo.toml',
    );
  });

  it('normalises backslashes in the target when it falls back to it', () => {
    relativeMock.mockReturnValue('');
    expect(relativeOrSelf('C:\\repo\\Cargo.toml', 'C:\\repo\\Cargo.toml')).toBe(
      'C:/repo/Cargo.toml',
    );
  });
});
