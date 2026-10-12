import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGit } from './run-git.js';
import { execCapture } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';

vi.mock('./utils/exec-capture.js');

const execMock = vi.mocked(execCapture);

function gitError(stderr: string): ExecError {
  return new ExecError('Command failed: git', '', stderr, 128);
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('runGit', () => {
  it('runs git with the argv and cwd, returning stdout with trailing whitespace trimmed', async () => {
    execMock.mockResolvedValue({ stdout: '  abc123\n\n', stderr: '' });
    await expect(runGit(['rev-parse', 'HEAD'], { cwd: 'repo' })).resolves.toBe('  abc123');
    expect(execMock).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], { cwd: 'repo' });
  });

  it('defaults its options bag to no cwd', async () => {
    execMock.mockResolvedValue({ stdout: 'x', stderr: '' });
    await runGit(['status']);
    expect(execMock).toHaveBeenCalledWith('git', ['status'], { cwd: undefined });
  });

  it('folds trimmed git stderr into the thrown error and keeps the cause', async () => {
    const err = gitError('\n   fatal: boom   \n');
    execMock.mockRejectedValue(err);
    const thrown = await caught(runGit(['diff']));
    expect(thrown.message).toBe('Command failed: git\nfatal: boom');
    expect(thrown.cause).toBe(err);
  });

  it('surfaces the bare message when stderr is empty', async () => {
    execMock.mockRejectedValue(gitError('   '));
    const thrown = await caught(runGit(['diff']));
    expect(thrown.message).toBe('Command failed: git');
  });

  it('surfaces the bare error message when the rejection is not an ExecError', async () => {
    execMock.mockRejectedValue(new Error('spawn git ENOMEM'));
    const thrown = await caught(runGit(['diff']));
    expect(thrown.message).toBe('spawn git ENOMEM');
  });

  it('stringifies a non-Error rejection into the thrown message', async () => {
    execMock.mockRejectedValue('git blew up: bare string reason');
    const thrown = await caught(runGit(['diff']));
    expect(thrown.message).toBe('git blew up: bare string reason');
  });

  it.each([
    '*** Please tell me who you are.',
    'fatal: unable to auto-detect email address',
  ])('gives an actionable identity hint naming the subcommand on %j (#206)', async (stderr) => {
    const err = gitError(stderr);
    execMock.mockRejectedValue(err);
    const thrown = await caught(runGit(['tag', '-a', 'v0.1.0']));
    expect(thrown.message).toBe(
      [
        'git tag: no committer identity configured.',
        'piot cuts annotated tags which require `user.name` + `user.email`.',
        'Configure them in the publish job before invoking piot:',
        '  - run: |',
        '      git config --global user.name "github-actions[bot]"',
        '      git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"',
        'See https://thekevinscott.github.io/putitoutthere/guide/runner-prerequisites',
        '',
        `Underlying git output:\n${stderr}`,
      ].join('\n'),
    );
    expect(thrown.cause).toBe(err);
  });

  it('does not give the identity hint for a non-ExecError carrying the same text', async () => {
    execMock.mockRejectedValue(new Error('Please tell me who you are'));
    const thrown = await caught(runGit(['tag']));
    expect(thrown.message).toBe('Please tell me who you are');
  });
});
