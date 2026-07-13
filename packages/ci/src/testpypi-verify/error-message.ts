/**
 * The text of a caught error, for the sdist retry loop's final-attempt line
 * `failed to download sdist for {req}: {exc}` (the bash's `str(exc)`). An
 * `Error` contributes its `message`; anything else is stringified. Pure.
 */

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
