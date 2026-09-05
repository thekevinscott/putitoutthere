import { execCapture } from '../utils/exec-capture.js';

export async function listTrackedFiles(cwd: string): Promise<string[] | null> {
  try {
    const { stdout } = await execCapture('git', ['ls-files'], { cwd });
    return stdout.split('\n').filter((l) => l.length > 0);
  } catch {
    return null;
  }
}
