/**
 * Delegates matrix computation to the fixture-matrix gate (#670) by
 * invoking its exported `runFixtureMatrix` as a black box and capturing the
 * stdout/stderr it would otherwise write to the process streams. This is
 * the only way to reuse that gate's logic without either modifying its
 * files (a separate, still-unmerged concern) or reimplementing it here
 * (design-commitments non-goal #7).
 */

import { runFixtureMatrix } from '../fixture-matrix/run.js';

export interface CapturedFixtureMatrix {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function captureFixtureMatrix(fixture: string): Promise<CapturedFixtureMatrix> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: unknown) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  process.stderr.write = (chunk: unknown) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };

  try {
    const exitCode = await runFixtureMatrix(['node', 'piot-ci', 'fixture-matrix', fixture]);
    return { exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}
