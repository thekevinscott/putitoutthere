#!/usr/bin/env node
/**
 * Binary entry for `piot-ci`. Kept separate from `cli.ts` so the
 * dispatcher can be unit-tested without triggering this top-level
 * `process.exit`.
 */

import { run } from './cli.js';

process.exit(run(process.argv));
