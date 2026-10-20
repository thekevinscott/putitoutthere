import { PROGRESS_KEY, type Carrier } from './publish-progress.js';
import type { PublishOutput } from './publish.js';

export function readPublishProgress(value: unknown): PublishOutput['published'] {
  if (!(value instanceof Error)) {return [];}
  return (value as Carrier)[PROGRESS_KEY] ?? [];
}
