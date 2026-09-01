/**
 * Parses and validates the WILLFIRE_INPUTS JSON payload for the
 * willfire-callback adapter (#681): extracts the `fixture` string it
 * needs, ignoring every other key. Split out from decide.ts per the
 * one-function-per-file convention — this helper is long enough to earn
 * its own file.
 */

export type ParseWillfireInputsResult = { ok: true; fixture: string } | { ok: false; reason: string };

export function parseWillfireInputs(inputsJson: string | undefined): ParseWillfireInputsResult {
  if (inputsJson === undefined || inputsJson === '') {
    return { ok: false, reason: 'willfire-callback: WILLFIRE_INPUTS must be set' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputsJson);
  } catch {
    return { ok: false, reason: 'willfire-callback: WILLFIRE_INPUTS is not valid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'willfire-callback: WILLFIRE_INPUTS must be a JSON object' };
  }

  const fixture = (parsed as Record<string, unknown>).fixture;
  if (typeof fixture !== 'string' || fixture === '') {
    return { ok: false, reason: "willfire-callback: WILLFIRE_INPUTS is missing a string 'fixture' field" };
  }

  return { ok: true, fixture };
}
