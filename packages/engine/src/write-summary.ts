import { appendFile } from 'node:fs/promises';

export async function writeSummary(md: string): Promise<void> {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {return;} // local runs / non-GHA CI — summary is a no-op
  await appendFile(path, md, 'utf8');
}
