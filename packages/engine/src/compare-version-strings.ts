import { compareVersionTuples } from './compare-version-tuples.js';
import { parsePythonVersion } from './parse-python-version.js';

export function compareVersionStrings(a: string, b: string): number {
  return compareVersionTuples(parsePythonVersion(a), parsePythonVersion(b));
}
