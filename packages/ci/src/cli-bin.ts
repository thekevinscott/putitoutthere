#!/usr/bin/env node
/**
 * Binary entry for `piot-ci`. Kept separate from `cli.ts` so the
 * dispatcher can be unit-tested without triggering this top-level
 * `process.exit`.
 */

import { run } from './cli.js';

run(process.argv).then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    process.stderr.write(
      `piot-ci: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(4);
  },
);
