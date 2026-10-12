import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ErrorCodes } from '../error-codes.js';

export async function assertRepositoryField(path: string): Promise<void> {
  const pkgJsonPath = join(path, 'package.json');
  const raw = await readFile(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(raw) as { repository?: unknown };
  const repository = pkg.repository;
  // Accept either the canonical object form (`{ type, url, … }`) or
  // the legacy single-string form. Both shapes must carry a non-empty
  // URL after trimming. `!pkg.repository` would pass `{}` and
  // `{ type: 'git' }` since both are truthy — that's the bug #280
  // is closing.
  let ok = false;
  if (typeof repository === 'string') {
    ok = repository.trim().length > 0;
  } else if (repository !== null && typeof repository === 'object') {
    const url = (repository as { url?: unknown }).url;
    ok = typeof url === 'string' && url.trim().length > 0;
  }
  if (!ok) {
    throw new Error(
      `[${ErrorCodes.NPM_MISSING_REPOSITORY}] npm publish --provenance requires a non-empty \`repository\` field in ${pkgJsonPath}. ` +
        'See https://github.com/thekevinscott/putitoutthere#kind--npm.',
    );
  }
}
