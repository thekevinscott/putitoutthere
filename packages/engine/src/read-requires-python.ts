import { readFile } from 'node:fs/promises';

import { parse as parseToml } from 'smol-toml';

export async function readRequiresPython(pyprojectPath: string): Promise<string | null> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(await readFile(pyprojectPath, 'utf8'));
  } catch {
    return null;
  }
  const project = parsed.project;
  if (typeof project !== 'object') {return null;}
  const req = (project as Record<string, unknown>)['requires-python'];
  return typeof req === 'string' ? req : null;
}
