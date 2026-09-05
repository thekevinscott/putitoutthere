#!/usr/bin/env node
/**
 * CLI binary entry. Kept separate from `src/cli.ts` so that the
 * ncc-bundled GitHub Action (`src/action.ts`, which imports `run` from
 * `./cli.js`) does not inline this file's top-level invocation. See #201.
 */

import { run } from './cli.js';
import { flushStdio } from './utils/flush-stdio.js';

run(process.argv).then(
  async (code) => {
    await flushStdio();
    process.exit(code);
  },
  async (err: unknown) => {
    process.stderr.write(
      `putitoutthere: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    await flushStdio();
    process.exit(4);
  },
);
