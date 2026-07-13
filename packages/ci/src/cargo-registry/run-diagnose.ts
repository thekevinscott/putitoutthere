/**
 * Composition root for the cargo-http-registry `diagnose` mode (#454). Reads the
 * raw registry log + cargo config, probes the git-smart-http endpoint for its
 * HTTP code (curl `-w %{http_code}`), and prints the grouped dump. Never fails
 * (the bash ran under `set +e`): a probe error yields whatever curl wrote to
 * stdout (empty on connection failure). The grouping is `diagnose-output.ts`'s.
 */

import { execFileSync } from 'node:child_process';

import { diagnoseOutput } from './diagnose-output.js';
import { readRaw } from './read-raw.js';

const ENDPOINT = 'http://127.0.0.1:35503/git/info/refs?service=git-upload-pack';
const PROBE_WRITE = 'GET /git/info/refs?service=git-upload-pack -> %{http_code}\\n';

export function runCargoRegistryDiagnose(): number {
  const runnerTemp = process.env.RUNNER_TEMP ?? '';
  const home = process.env.HOME ?? '';

  let probeRaw: string;
  try {
    probeRaw = execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', PROBE_WRITE, ENDPOINT], { encoding: 'utf8' });
  } catch (err) {
    probeRaw = (err as { stdout?: string }).stdout ?? '';
  }

  process.stdout.write(
    diagnoseOutput({
      logRaw: readRaw(`${runnerTemp}/cargo-http-registry.log`),
      probeRaw,
      configRaw: readRaw(`${home}/.cargo/config.toml`),
    }),
  );
  return 0;
}
