import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { parseCargoToml } from './parse-cargo-toml.js';

vi.mock('node:fs/promises');

describe('parseCargoToml', () => {
  it('parses a readable manifest', async () => {
    vi.mocked(readFile).mockResolvedValue('[package]\nname = "mycrate"\n');
    expect(await parseCargoToml('/repo/Cargo.toml')).toEqual({ package: { name: 'mycrate' } });
    expect(readFile).toHaveBeenCalledWith('/repo/Cargo.toml', 'utf8');
  });

  it('returns null when the file cannot be read', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    expect(await parseCargoToml('/repo/Cargo.toml')).toBeNull();
  });

  it('returns null for malformed TOML', async () => {
    vi.mocked(readFile).mockResolvedValue('not = = toml');
    expect(await parseCargoToml('/repo/Cargo.toml')).toBeNull();
  });
});
