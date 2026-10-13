import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCompleteness, type MatrixRow, type PackageCompleteness } from './completeness.js';
import { expectedLayout } from './expected-layout.js';
import { requireCompleteness } from './require-completeness.js';

vi.mock('./completeness.js');
vi.mock('./expected-layout.js');

const checkMock = vi.mocked(checkCompleteness);
const layoutMock = vi.mocked(expectedLayout);

function row(over: Partial<MatrixRow>): MatrixRow {
  return { name: 'demo', kind: 'pypi', version: '0.1.0', target: 'sdist', artifact_name: 'demo-sdist', ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  layoutMock.mockImplementation((r) => `<layout ${r.artifact_name}>`);
});

describe('requireCompleteness', () => {
  it('resolves when every package is ok', async () => {
    const matrix = [row({})];
    checkMock.mockResolvedValue(new Map([['demo', { ok: true, missing: [] }]]));
    await expect(requireCompleteness(matrix, 'artifacts')).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(matrix, 'artifacts');
  });

  it('throws one block per failed package listing every missing row and its expected layout', async () => {
    const x86 = row({ name: 'c', target: 'x86', artifact_name: 'c-x86' });
    const arm = row({ name: 'c', target: 'arm', artifact_name: 'c-arm' });
    checkMock.mockResolvedValue(
      new Map<string, PackageCompleteness>([
        ['ok-pkg', { ok: true, missing: [] }],
        ['c', { ok: false, missing: [{ row: x86, reason: 'gone' }, { row: arm, reason: 'empty' }] }],
      ]),
    );
    await expect(requireCompleteness([x86, arm], 'artifacts')).rejects.toThrow(
      [
        'Artifact completeness check failed:',
        '  c:',
        '    - target=x86 artifact=c-x86: gone',
        '      expected: <layout c-x86>',
        '    - target=arm artifact=c-arm: empty',
        '      expected: <layout c-arm>',
        '',
        'Naming contract: plan.md §12.4 (artifacts/{artifact_name}/).',
        'No side effects performed. Fix the build and re-run.',
      ].join('\n'),
    );
  });
});
