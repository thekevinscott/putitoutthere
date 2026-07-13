/**
 * Composition root for the Verdaccio-auth harness (#453). Performs the real I/O
 * the "Configure Verdaccio auth (first-publish)" bash did: poll `/-/ping` until
 * Verdaccio binds, PUT the user-create request, parse the token, then hand the
 * matrix + token to `decideVerdaccioAuth`, write the per-package `.npmrc`
 * files, emit the lines, and return the exit code. curl/sleep run through the
 * same subprocess boundary the bash used so the tools + flags are identical.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { decideVerdaccioAuth } from './decide.js';

const PING_URL = 'http://localhost:4873/-/ping';
const USER_CREATE_URL = 'http://localhost:4873/-/user/org.couchdb.user:e2e';
const USER_CREATE_BODY = '{"name":"e2e","password":"e2e","email":"e2e@piot.dev"}';
const MAX_PING_ATTEMPTS = 10;

function pingOnce(): boolean {
  try {
    execFileSync('curl', ['-fsS', PING_URL], { stdio: 'ignore' });
  } catch {
    return false;
  }
  return true;
}

export function runVerdaccioAuth(): number {
  for (let attempt = 1; attempt <= MAX_PING_ATTEMPTS; attempt++) {
    if (pingOnce()) {
      process.stdout.write(`Verdaccio up (attempt ${attempt})\n`);
      break;
    }
    if (attempt === MAX_PING_ATTEMPTS) {
      process.stdout.write('::error::Verdaccio /-/ping unreachable after 10 attempts\n');
      return 1;
    }
    execFileSync('sleep', ['1'], { stdio: 'ignore' });
  }

  const response = execFileSync(
    'curl',
    ['-fsS', '-X', 'PUT', '-H', 'Content-Type: application/json', '--data', USER_CREATE_BODY, USER_CREATE_URL],
    { encoding: 'utf8' },
  );
  // jq -r '.token' prints 'null' for an absent/null key; a present token is a
  // string. Match that: fall back to the literal 'null', otherwise use it as-is.
  const parsed = JSON.parse(response) as { token?: string | null };
  const token = parsed.token === undefined || parsed.token === null ? 'null' : parsed.token;

  const result = decideVerdaccioAuth({ matrix: process.env.MATRIX ?? '', token, response });
  for (const file of result.files) {
    writeFileSync(file.path, file.content);
  }
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`);
  }
  return result.exitCode;
}
