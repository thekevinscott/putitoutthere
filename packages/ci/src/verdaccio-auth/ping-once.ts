import { execCapture } from '../utils/exec-capture.js';

export async function pingOnce(): Promise<boolean> {
  try {
    await execCapture('curl', ['-fsS', 'http://localhost:4873/-/ping']);
  } catch {
    return false;
  }
  return true;
}
