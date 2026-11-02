import { relative } from 'node:path';

export function relativeOrSelf(base: string, target: string): string {
  const r = relative(base, target);
  return (r === '' ? target : r).replaceAll('\\', '/');
}
