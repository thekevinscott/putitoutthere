/**
 * Dirty-tree scan tests (#135).
 *
 * Unit-suite isolation: the git subprocess (the process seam —
 * `execCapture`) is mocked, so each case drives the scan through canned
 * porcelain rather than a real repo. Real git behavior is covered by the
 * crates integration tier (tests/integration/crates.integration.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture, type ExecResult } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { scanDirtyOutsideManifest } from './scan-dirty-outside-manifest.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
vi.mock('../utils/exec-capture.js');

const execMock = vi.mocked(execCapture);

/** A resolved `execCapture` result carrying `stdout`. */
function ok(stdout: string): ExecResult {
  return { stdout, stderr: '' };
}

beforeEach(() => {
  execMock.mockReset();
});

describe('scanDirtyOutsideManifest (#135)', () => {
  // The git subprocess is mocked: `rev-parse --show-toplevel` establishes the
  // worktree, `ls-files` reports the managed Cargo.toml's repo-relative path,
  // and `status --porcelain` supplies the dirty set. porcelain paths are
  // forward-slashed (git renders them that way on every platform).
  interface GitRoutes {
    /** When true, `git rev-parse --show-toplevel` throws (not a worktree). */
    noRepo?: boolean;
    toplevel?: string;
    managedRel?: string;
    porcelain?: string;
    /** When true, `git ls-files -- Cargo.toml` throws (Cargo.toml untracked). */
    lsFilesThrows?: boolean;
    /** When true, `git status --porcelain` throws after rev-parse succeeded. */
    statusThrows?: boolean;
  }

  function mockGit(routes: GitRoutes): void {
    execMock.mockImplementation((file: string, args?: readonly string[]) => {
      if (file !== 'git') {return Promise.reject(new ExecError(`unexpected exec: ${file}`, '', '', null));}
      const a = (args ?? []) as string[];
      if (a[0] === 'rev-parse') {
        if (routes.noRepo) {return Promise.reject(new ExecError('not a git repo', '', '', null));}
        return Promise.resolve(ok(`${routes.toplevel ?? '/repo'}\n`));
      }
      if (a[0] === 'ls-files') {
        if (routes.lsFilesThrows) {return Promise.reject(new ExecError('not in index', '', '', 1));}
        return Promise.resolve(ok(`${routes.managedRel ?? ''}\n`));
      }
      if (a[0] === 'status') {
        if (routes.statusThrows) {return Promise.reject(new ExecError('status failed', '', '', 128));}
        return Promise.resolve(ok(routes.porcelain ?? ''));
      }
      return Promise.reject(new ExecError(`unexpected git: ${a.join(' ')}`, '', '', null));
    });
  }

  it('returns an empty list when only the managed Cargo.toml is dirty', async () => {
    mockGit({ managedRel: 'Cargo.toml', porcelain: ' M Cargo.toml\n' });
    expect(await scanDirtyOutsideManifest('/repo', '/repo')).toEqual([]);
    // The three git probes run with their exact argv + cwd scoping.
    expect(execMock).toHaveBeenCalledWith('git', ['rev-parse', '--show-toplevel'], { cwd: '/repo' });
    expect(execMock).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--full-name', '--', 'Cargo.toml'],
      { cwd: '/repo' },
    );
    expect(execMock).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/repo' });
  });

  it('flags a stray dirty file outside the package dir', async () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('README.md');
    expect(result).not.toContain('crate/Cargo.toml');
  });

  it('allows nothing when git names no path for the managed Cargo.toml', async () => {
    // `ls-files` succeeding with empty output means the manifest is untracked
    // — git will never name it in porcelain either, so there is no managed
    // path to whitelist and every dirty file is unexpected. Distinct from the
    // `ls-files` *throwing* case below, which takes the catch arm.
    mockGit({ managedRel: '', porcelain: ' M crate/Cargo.toml\n' });
    expect(await scanDirtyOutsideManifest('/repo', '/repo/crate')).toEqual(['crate/Cargo.toml']);
  });

  it('tolerates a manifest writeVersion wrote outside the package dir (#639)', async () => {
    // A crate inheriting `version.workspace = true` has its bump land in the
    // workspace root's Cargo.toml. That file is outside the package
    // directory, so without being told, the guard reads the engine's own
    // managed write as a stray edit and refuses the publish.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M Cargo.toml\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', undefined, undefined, [
      '/repo/Cargo.toml',
    ]);
    expect(result).toEqual([]);
  });

  it('still flags a stray edit that is not one of the managed manifests', async () => {
    // The whitelist is exactly the files the engine wrote — everything else
    // is still refused, which is the point of the guard.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', undefined, undefined, [
      '/repo/Cargo.toml',
    ]);
    expect(result).toEqual(['README.md']);
  });

  it('ignores a managed path that does not sit under the working tree', async () => {
    // git names dirty files relative to the repo root, so a path outside it
    // could never match one. Admitting it would put a `../…` string in the
    // whitelist that only ever fails to match — silently useless rather than
    // wrong, but worth not carrying.
    mockGit({ managedRel: 'crate/Cargo.toml', porcelain: ' M README.md\n' });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', undefined, undefined, [
      '/elsewhere/Cargo.toml',
    ]);
    expect(result).toEqual(['README.md']);
  });

  it('flags a dirty sibling file inside the package dir that is not Cargo.toml', async () => {
    // Only src/lib.rs dirty -- the managed Cargo.toml is unchanged. Still
    // a surprise: our writeVersion didn't produce this edit.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/src/lib.rs\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/src/lib.rs');
  });

  it('skips files under artifactsRoot — engine-managed scratch (#244)', async () => {
    // The reusable workflow's `actions/download-artifact@v4` step always
    // creates `artifacts/` under cwd, even when nothing was uploaded
    // (crates-only fixtures). git status sees `?? artifacts/` and the
    // pre-publish dirty-check would refuse cargo publish unless it
    // recognises this directory as engine-managed.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n?? artifacts/\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo/artifacts');
    expect(result).toEqual([]);
  });

  it('still flags non-artifacts-root files when artifactsRoot is provided', async () => {
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n?? artifacts/file.txt\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo/artifacts');
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('artifacts'))).toBe(false);
  });

  it('returns null when cwd is not inside a git worktree', async () => {
    mockGit({ noRepo: true });
    expect(await scanDirtyOutsideManifest('/plain', '/plain')).toBeNull();
  });

  it('returns null when git reports an empty toplevel', async () => {
    // rev-parse succeeds but prints only whitespace — treat as "can't
    // verify" and fall through to cargo's own --allow-dirty behavior.
    mockGit({ toplevel: '' });
    expect(await scanDirtyOutsideManifest('/repo', '/repo')).toBeNull();
  });

  it('treats every dirty file as unexpected when Cargo.toml is untracked', async () => {
    // Fresh tree, first release: `git ls-files -- Cargo.toml` fails because
    // the manifest is not yet in the index. managedRel stays empty, so nothing
    // is exempted — even a dirty Cargo.toml is flagged, refusing the publish
    // rather than silently packing an unexpected edit.
    mockGit({ lsFilesThrows: true, porcelain: ' M crate/Cargo.toml\n' });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/Cargo.toml');
  });

  it('returns null when git status fails after rev-parse succeeded', async () => {
    // rev-parse established the worktree, but the porcelain read then errors
    // (e.g. a mid-run index lock). Bail to null and let cargo's own
    // --allow-dirty handling take over rather than crashing the publish.
    mockGit({ managedRel: 'crate/Cargo.toml', statusThrows: true });
    expect(await scanDirtyOutsideManifest('/repo', '/repo/crate')).toBeNull();
  });

  it('handles artifactsRoot equal to cwd (empty relative path)', async () => {
    // relative(cwd, artifactsRoot) === '' when they are the same dir; the
    // artifacts-skip is then disabled (empty prefix), so stray files still
    // surface.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', '/repo');
    expect(result).toContain('README.md');
  });

  it('skips sibling paths that equal cwd or resolve outside the worktree', async () => {
    // A sibling equal to cwd (relative === '') and a sibling outside cwd
    // (relative starts with '..') are both skipped by the guard, leaving
    // only genuine strays flagged.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n M README.md\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate', undefined, [
      '/repo',
      '/outside',
    ]);
    expect(result).toContain('README.md');
  });

  it('skips files inside sibling package paths — workflow-managed install state', async () => {
    // Polyglot setup: rust crate at packages/rust/, npm package at
    // packages/ts/. The reusable workflow's `Build npm packages` step
    // creates packages/ts/{node_modules,dist,package-lock.json} as
    // untracked files before cargo publish runs. None of that can end
    // up in the rust crate's tarball — cargo only packs from
    // packages/rust/ — so the dirty check shouldn't refuse on them.
    mockGit({
      managedRel: 'packages/rust/Cargo.toml',
      porcelain: [
        ' M packages/rust/Cargo.toml',
        '?? packages/ts/node_modules/typescript/bin/tsc',
        '?? packages/ts/package-lock.json',
        '?? packages/ts/dist/index.js',
        '',
      ].join('\n'),
    });
    const result = await scanDirtyOutsideManifest(
      '/repo',
      '/repo/packages/rust',
      undefined,
      ['/repo/packages/ts'],
    );
    expect(result).toEqual([]);
  });

  it('still flags non-sibling paths when siblingPackagePaths is provided', async () => {
    mockGit({
      managedRel: 'packages/rust/Cargo.toml',
      porcelain: [
        ' M packages/rust/Cargo.toml',
        ' M README.md',
        '?? packages/ts/dist',
        '',
      ].join('\n'),
    });
    const result = await scanDirtyOutsideManifest(
      '/repo',
      '/repo/packages/rust',
      undefined,
      ['/repo/packages/ts'],
    );
    expect(result).toContain('README.md');
    expect(result?.some((p) => p.startsWith('packages/ts'))).toBe(false);
  });

  it('reads the destination path from a porcelain rename row (XY old -> new)', async () => {
    // git renders renames as `R  old -> new`; the scan must flag the
    // destination path, not the arrow-joined raw row.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\nR  old-name.rs -> crate/src/new-name.rs\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/src/new-name.rs');
    expect(result).not.toContain('old-name.rs -> crate/src/new-name.rs');
  });

  it('strips git quoting from a quoted porcelain path', async () => {
    // git quotes paths containing spaces/unusual bytes as `"a b.rs"`; the
    // scan must compare/report the unquoted form.
    mockGit({
      managedRel: 'crate/Cargo.toml',
      porcelain: ' M crate/Cargo.toml\n?? "crate/a file.rs"\n',
    });
    const result = await scanDirtyOutsideManifest('/repo', '/repo/crate');
    expect(result).toContain('crate/a file.rs');
    expect(result).not.toContain('"crate/a file.rs"');
  });
});
