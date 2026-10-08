import type { Bullet } from './evidence-check-types.js';
import { isBulletLine } from './bullet-line.js';

/** The Markdown bullets in a fragment's content, each with its 1-based line. */
export function fragmentBullets(path: string, content: string): Bullet[] {
  const bullets: Bullet[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    if (isBulletLine(text)) {
      bullets.push({ path, line: index + 1, text });
    }
  });
  return bullets;
}
