import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkRepoUrlMatch } from '../preflight.js';
import { checkRepoUrlMatchFindings } from './check-repo-url-match-findings.js';
import type { CheckFinding } from '../check.js';

vi.mock('../preflight.js');

import type { Package } from '../config.js';

const packages = [{ name: 'pkg-a', kind: 'npm' }] as unknown as readonly Package[];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('checkRepoUrlMatchFindings', () => {
  it('passes GITHUB_REPOSITORY from the process env to the preflight', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.mocked(checkRepoUrlMatch).mockResolvedValue([]);
    const findings: CheckFinding[] = [];
    await checkRepoUrlMatchFindings(packages, findings);
    expect(checkRepoUrlMatch).toHaveBeenCalledWith(packages, { githubRepository: 'owner/repo' });
    expect(findings).toEqual([]);
  });

  it('maps each preflight finding to a coded, package-scoped message', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.mocked(checkRepoUrlMatch).mockResolvedValue([
      {
        package: 'pkg-a',
        manifestPath: 'js/package.json',
        declaredOwnerRepo: 'other/elsewhere',
        expectedOwnerRepo: 'owner/repo',
        declaredUrl: 'git+https://github.com/other/elsewhere.git',
      },
    ]);
    const findings: CheckFinding[] = [];
    await checkRepoUrlMatchFindings(packages, findings);
    expect(findings).toEqual([
      {
        package: 'pkg-a',
        message:
          '[PIOT_REPO_URL_MISMATCH] js/package.json: declared repository "other/elsewhere" does not match GITHUB_REPOSITORY "owner/repo". npm rejects `--provenance` publishes whose package.json#repository.url disagrees with the OIDC source claim (422); crates.io / PyPI trusted-publisher paths carry the same risk.',
      },
    ]);
  });
});
