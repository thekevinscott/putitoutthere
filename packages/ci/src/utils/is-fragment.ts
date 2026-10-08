/**
 * Whether a repo-relative path is a changelog/migration fragment directly
 * inside `dir`: `<dir>/YYYY-MM-DD-<slug>.md`, slug of lowercase letters,
 * digits and hyphens (#730). The folder's README.md never matches.
 */
export function isFragment(path: string, dir: string): boolean {
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(path.slice(prefix.length));
}
