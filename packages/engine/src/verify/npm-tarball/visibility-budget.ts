// 20 minutes; npm has taken up to 16m14s to record a version (#785).
export const NPM_VISIBILITY_DEADLINE_MS = 1_200_000;

export function npmVisibilityBudget(registry: string | undefined): { sleeps: number[]; deadline?: number } {
  return registry
    ? { sleeps: [1, 2, 5, 10] }
    : { sleeps: [5, 15, 30, 60], deadline: Date.now() + NPM_VISIBILITY_DEADLINE_MS };
}
