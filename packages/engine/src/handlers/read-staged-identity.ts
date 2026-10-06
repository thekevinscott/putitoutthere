import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readStagedIdentity(stagingDir: string): Promise<{ name: string; version: string }> {
  const pkg = JSON.parse(await readFile(join(stagingDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return { name: pkg.name, version: pkg.version };
}
