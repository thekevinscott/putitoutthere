import { assertNoCycles } from '../cascade.js';
import type { Package } from '../config.js';
import { toError } from '../to-error.js';
import type { CheckFinding } from './check-types.js';

export function checkDependsOn(packages: readonly Package[], findings: CheckFinding[]): void {
  try {
    assertNoCycles(packages);
  } catch (err) {
    findings.push({
      message: toError(err).message,
    });
  }
}
