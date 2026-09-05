import { readdir } from 'node:fs/promises';

export async function listFixtures(fixturesRoot: string): Promise<string[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
