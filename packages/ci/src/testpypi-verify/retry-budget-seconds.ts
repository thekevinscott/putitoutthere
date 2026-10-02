/**
 * What the bounded retry loops spend waiting before they give up, in seconds.
 * The loops sleep *between* attempts, so `MAX_ATTEMPTS` attempts spend
 * `MAX_ATTEMPTS - 1` back-offs. A duration is the only thing the budget states,
 * so the error lines quote this rather than an attempt count. Pure.
 */

import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

export function retryBudgetSeconds(): number {
  let total = 0;
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    total += retrySleepSeconds(attempt);
  }
  return total;
}
