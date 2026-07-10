#!/usr/bin/env node
// Boundary for the Evidence-check gate.
//
// The decision logic lives in the tested, I/O-free `checkEvidence`
// orchestrator under `src/ci/evidence-check/` (built to `dist/`, covered
// by unit + integration suites). This file wires the real
// subprocess/file dependencies the orchestrator takes as injected deps:
// the `git diff`, the `gh api` calls, the poll `sleep`, and the clock.
// Keeping the untestable I/O here (out of `src/`) is what lets the
// orchestrator be exercised deterministically. See AGENTS.md >
// "Verification policy".

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { checkEvidence } from '../../dist/ci/evidence-check/index.js';

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const repository = process.env.GITHUB_REPOSITORY;

if (!baseSha || !headSha || !repository) {
  console.error('::error::evidence-check: BASE_SHA, HEAD_SHA and GITHUB_REPOSITORY must be set');
  process.exit(2);
}

const diff = execFileSync('git', ['diff', '--unified=0', baseSha, headSha, '--', 'CHANGELOG.md'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const changelog = readFileSync('CHANGELOG.md', 'utf8');

const ghApi = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', '-X', 'GET', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );

const sleepSeconds = (seconds) => execFileSync('sleep', [String(seconds)], { stdio: 'ignore' });

const code = checkEvidence({
  changelog,
  diff,
  baseSha,
  headSha,
  repository,
  ghApi,
  sleepSeconds,
  now: () => Date.now(),
  log: (message) => console.log(message),
});

process.exit(code);
