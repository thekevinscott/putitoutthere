import { execCapture } from '../utils/exec-capture.js';

const PING_URL = 'http://localhost:4873/-/ping';

export async function pingOnce(): Promise<boolean> {
  try {
    await execCapture('curl', ['-fsS', PING_URL]);
  } catch {
    return false;
  }
  return true;
}
