/**
 * Extract the `Version:` field from wheel `METADATA` / sdist `PKG-INFO` text,
 * reproducing the bash's `for line in metadata.splitlines(): if
 * line.startswith("Version: "): actual = line.removeprefix("Version: ").strip()`.
 * Returns the first matching version, or `null` when no `Version:` line is
 * present (the bash's `actual = None`). Pure.
 */

const VERSION_PREFIX = 'Version: ';

export function metadataVersion(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.startsWith(VERSION_PREFIX)) {
      return line.slice(VERSION_PREFIX.length).trim();
    }
  }
  return null;
}
