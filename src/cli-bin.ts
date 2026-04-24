#!/usr/bin/env node
/**
 * CLI binary entry. Kept separate from `src/cli.ts` so that the
 * ncc-bundled GitHub Action (`src/action.ts`, which imports `run` from
 * `./cli.js`) does not inline this file's top-level invocation. See #201.
 */

import { run } from './cli.js';

run(process.argv).then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    process.stderr.write(
      `putitoutthere: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(4);
  },
);
