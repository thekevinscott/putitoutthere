import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runChangelogCheck } from './changelog-check/run.js';
import { run } from './cli.js';
import { runEvidenceCheck } from './evidence-check/run.js';

vi.mock('./changelog-check/run.js');
vi.mock('./evidence-check/run.js');

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const argv = (...rest: string[]) => ['node', 'piot-ci', ...rest];

describe('piot-ci dispatcher', () => {
  it('prints usage to stdout and exits 1 with no command', () => {
    const code = run(argv());
    expect(code).toBe(1);
    expect(out.join('')).toContain('piot-ci — putitoutthere repo-internal CI gates');
    expect(err.join('')).toBe('');
  });

  it.each(['help', '--help', '-h'])('prints usage and exits 0 for %s', (flag) => {
    const code = run(argv(flag));
    expect(code).toBe(0);
    expect(out.join('')).toContain('Usage: piot-ci <command>');
  });

  it('reports an unknown command on stderr, prints usage, exits 1', () => {
    const code = run(argv('bogus'));
    expect(code).toBe(1);
    expect(err.join('')).toContain("piot-ci: unknown command 'bogus'");
    expect(out.join('')).toContain('Usage: piot-ci <command>');
  });

  it('dispatches changelog-check to its gate and returns its exit code', () => {
    vi.mocked(runChangelogCheck).mockReturnValue(1);
    const code = run(argv('changelog-check'));
    expect(code).toBe(1);
    expect(runChangelogCheck).toHaveBeenCalledOnce();
    expect(err.join('')).toBe('');
  });

  it('dispatches evidence-check to its gate and returns its exit code', () => {
    vi.mocked(runEvidenceCheck).mockReturnValue(1);
    const code = run(argv('evidence-check'));
    expect(code).toBe(1);
    expect(runEvidenceCheck).toHaveBeenCalledOnce();
    expect(err.join('')).toBe('');
  });
});
