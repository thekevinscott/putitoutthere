/**
 * Composition-root wiring test for the fixture-matrix gate (#670). Mocks
 * every collaborator — `./list-fixtures.js`, `./decide.js`,
 * `./materialize-fixture.js`, the real engine `plan()`, and
 * `./build-document.js` — so this isolates the plumbing: argv parsing, the
 * stdout/stderr/exit-code contract, and that cleanup always runs. The real
 * listing, decision, and materialization are covered in their own colocated
 * tests; end-to-end fidelity against the real engine is the integration
 * tier's job.
 */

import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plan } from 'putitoutthere';

import { buildFixtureMatrixDocument, type FixtureMatrixDocument } from './build-document.js';
import { decideFixtureMatrix } from './decide.js';
import { listFixtures } from './list-fixtures.js';
import { materializeFixtureForMatrix } from './materialize-fixture.js';
import { runFixtureMatrix } from './run.js';

// Real module: the test resolves its own location to reach the fixtures root.
vi.mock('node:url', async () => await vi.importActual<typeof import('node:url')>('node:url'));
vi.mock('node:fs/promises');
vi.mock('putitoutthere');
vi.mock('./decide.js');
vi.mock('./list-fixtures.js');
vi.mock('./materialize-fixture.js');
vi.mock('./build-document.js');

const listFixturesMock = vi.mocked(listFixtures);
const rmMock = vi.mocked(rm);
const planMock = vi.mocked(plan);
const decideMock = vi.mocked(decideFixtureMatrix);
const materializeMock = vi.mocked(materializeFixtureForMatrix);
const buildDocMock = vi.mocked(buildFixtureMatrixDocument);

const out: string[] = [];
const err: string[] = [];
const TMP_DIR = '/tmp/piot-fixture-matrix-xyz';
// Same relative resolution as run.ts — this test is colocated with it.
const FIXTURES_ROOT = fileURLToPath(new URL('../../../engine/tests/fixtures', import.meta.url));
const EMPTY_DOC: FixtureMatrixDocument = { fixture: 'js-vanilla', matrix: [], has_pypi: false };

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  err.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  listFixturesMock.mockResolvedValue(['js-vanilla']);
  materializeMock.mockResolvedValue(TMP_DIR);
  planMock.mockResolvedValue([]);
  buildDocMock.mockReturnValue(EMPTY_DOC);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const argv = (fixture?: string) => ['node', 'piot-ci', 'fixture-matrix', ...(fixture === undefined ? [] : [fixture])];

describe('runFixtureMatrix: fixture listing feeds decide', () => {
  it('lists fixtures from the resolved fixtures root and hands them to decide', async () => {
    decideMock.mockReturnValue({ ok: true, fixture: 'js-vanilla' });
    await runFixtureMatrix(argv('js-vanilla'));
    expect(listFixturesMock).toHaveBeenCalledWith(FIXTURES_ROOT);
    expect(decideMock).toHaveBeenCalledWith({ fixtureArg: 'js-vanilla', availableFixtures: ['js-vanilla'] });
  });
});

describe('runFixtureMatrix: failure path', () => {
  it('writes the prefixed reason to stderr, prints nothing to stdout, and returns 1 without materializing', async () => {
    decideMock.mockReturnValue({
      ok: false,
      reason: "no fixture named 'nope' under packages/engine/tests/fixtures",
    });
    const code = await runFixtureMatrix(argv('nope'));
    expect(code).toBe(1);
    expect(err.join('')).toBe(
      "piot-ci fixture-matrix: no fixture named 'nope' under packages/engine/tests/fixtures\n",
    );
    expect(out.join('')).toBe('');
    expect(materializeMock).not.toHaveBeenCalled();
  });
});

describe('runFixtureMatrix: success path', () => {
  it('materializes, plans, builds the document, and prints it as one JSON line', async () => {
    decideMock.mockReturnValue({ ok: true, fixture: 'js-vanilla' });
    const code = await runFixtureMatrix(argv('js-vanilla'));
    expect(code).toBe(0);
    expect(materializeMock).toHaveBeenCalledWith(FIXTURES_ROOT, 'js-vanilla');
    expect(planMock).toHaveBeenCalledWith({ cwd: TMP_DIR });
    expect(buildDocMock).toHaveBeenCalledWith('js-vanilla', []);
    expect(out.join('')).toBe(`${JSON.stringify(EMPTY_DOC)}\n`);
  });

  it('cleans up the materialized dir even when plan() throws', async () => {
    decideMock.mockReturnValue({ ok: true, fixture: 'js-vanilla' });
    planMock.mockRejectedValue(new Error('boom'));
    await expect(runFixtureMatrix(argv('js-vanilla'))).rejects.toThrow('boom');
    expect(rmMock).toHaveBeenCalledWith(TMP_DIR, { recursive: true, force: true });
  });
});
