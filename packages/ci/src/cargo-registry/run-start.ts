/**
 * Composition root for the cargo-http-registry `start` mode (#454). Backgrounds
 * the registry as a detached process writing to a log file, exports its PID to
 * GITHUB_ENV, polls the git-smart-http endpoint until ready (curl + 1s sleep),
 * and on success appends the `git-fetch-with-cli` cargo config; on failure it
 * dumps the raw log and fails. curl/sleep run through the same subprocess
 * boundary the bash used. The readiness decision is `decide-start.ts`'s.
 */

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';

import { decideCargoRegistryStart } from './decide-start.js';
import { readRaw } from './read-raw.js';

const ADDR = '127.0.0.1:35503';
const ENDPOINT = 'http://127.0.0.1:35503/git/info/refs?service=git-upload-pack';
const CONFIG_APPEND = '\n[net]\ngit-fetch-with-cli = true\n';
const MAX_START_ATTEMPTS = 15;

export function runCargoRegistryStart(): number {
  const runnerTemp = process.env.RUNNER_TEMP;
  const githubEnv = process.env.GITHUB_ENV;
  const home = process.env.HOME;
  if (
    runnerTemp === undefined ||
    runnerTemp === '' ||
    githubEnv === undefined ||
    githubEnv === '' ||
    home === undefined ||
    home === ''
  ) {
    process.stdout.write('::error::cargo-registry: RUNNER_TEMP, GITHUB_ENV and HOME must be set.\n');
    return 1;
  }

  const regRoot = `${runnerTemp}/piot-alt-registry`;
  const logPath = `${runnerTemp}/cargo-http-registry.log`;
  mkdirSync(regRoot, { recursive: true });

  const logFd = openSync(logPath, 'w');
  const child = spawn('cargo-http-registry', ['--addr', ADDR, regRoot], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  appendFileSync(githubEnv, `CARGO_HTTP_REGISTRY_PID=${child.pid}\n`);

  let ready = false;
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    try {
      execFileSync('curl', ['-fsS', '-o', '/dev/null', ENDPOINT], { stdio: 'ignore' });
      process.stdout.write(`cargo-http-registry up (attempt ${attempt})\n`);
      ready = true;
      break;
    } catch {
      execFileSync('sleep', ['1'], { stdio: 'ignore' });
    }
  }

  const decision = decideCargoRegistryStart({ ready });
  if (decision.errorLine !== null) {
    process.stdout.write(`${decision.errorLine}\n`);
    process.stdout.write(readRaw(logPath) ?? '');
    return decision.exitCode;
  }

  mkdirSync(`${home}/.cargo`, { recursive: true });
  appendFileSync(`${home}/.cargo/config.toml`, CONFIG_APPEND);
  return decision.exitCode;
}
