import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runActionlintIdToken } from './actionlint-idtoken/run.js';
import { runCargoRegistry } from './cargo-registry/run.js';
import { runChangelogCheck } from './changelog-check/run.js';
import { run } from './cli.js';
import { runEvidenceCheck } from './evidence-check/run.js';
import { runFixtureMaterialize } from './fixture-materialize/run.js';
import { runTddLint } from './tdd-lint/run.js';
import { runVerdaccioAuth } from './verdaccio-auth/run.js';

vi.mock('./actionlint-idtoken/run.js');
vi.mock('./cargo-registry/run.js');
vi.mock('./changelog-check/run.js');
vi.mock('./evidence-check/run.js');
vi.mock('./fixture-materialize/run.js');
vi.mock('./tdd-lint/run.js');
vi.mock('./verdaccio-auth/run.js');

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

  it('dispatches tdd-lint to its gate and returns its exit code', () => {
    vi.mocked(runTddLint).mockReturnValue(1);
    const code = run(argv('tdd-lint'));
    expect(code).toBe(1);
    expect(runTddLint).toHaveBeenCalledOnce();
    expect(err.join('')).toBe('');
  });

  it('dispatches actionlint-idtoken to its gate and returns its exit code', () => {
    vi.mocked(runActionlintIdToken).mockReturnValue(1);
    const code = run(argv('actionlint-idtoken'));
    expect(code).toBe(1);
    expect(runActionlintIdToken).toHaveBeenCalledOnce();
    expect(err.join('')).toBe('');
  });

  it('dispatches evidence-check to its gate and returns its exit code', () => {
    vi.mocked(runEvidenceCheck).mockReturnValue(1);
    const code = run(argv('evidence-check'));
    expect(code).toBe(1);
    expect(runEvidenceCheck).toHaveBeenCalledOnce();
    expect(err.join('')).toBe('');
  });

  it('dispatches fixture-materialize to its gate, forwarding argv, and returns its exit code', () => {
    vi.mocked(runFixtureMaterialize).mockReturnValue(1);
    const code = run(argv('fixture-materialize', 'plan'));
    expect(code).toBe(1);
    expect(runFixtureMaterialize).toHaveBeenCalledWith(['node', 'piot-ci', 'fixture-materialize', 'plan']);
    expect(err.join('')).toBe('');
  });

  it('dispatches verdaccio-auth to its gate and returns its exit code', () => {
    vi.mocked(runVerdaccioAuth).mockReturnValue(1);
    const code = run(argv('verdaccio-auth'));
    expect(code).toBe(1);
    expect(runVerdaccioAuth).toHaveBeenCalledOnce();
    expect(err.join('')).toBe('');
  });

  it('dispatches cargo-registry to its gate, forwarding argv, and returns its exit code', () => {
    vi.mocked(runCargoRegistry).mockReturnValue(1);
    const code = run(argv('cargo-registry', 'start'));
    expect(code).toBe(1);
    expect(runCargoRegistry).toHaveBeenCalledWith(['node', 'piot-ci', 'cargo-registry', 'start']);
    expect(err.join('')).toBe('');
  });
});
