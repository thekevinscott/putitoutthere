import type { Ctx } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';

export async function isPlatformPublished(
  platformName: string,
  version: string,
  ctx: Ctx,
): Promise<boolean> {
  try {
    await execCapture('npm', ['view', `${platformName}@${version}`, 'version'], {
      cwd: ctx.cwd,
    });
    return true;
  } catch {
    return false;
  }
}
