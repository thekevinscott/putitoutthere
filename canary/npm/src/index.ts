// Live canary against real npm — see canary/putitoutthere.toml. The
// post-publish verify step in .github/workflows/canary.yml imports
// `version` and asserts it matches the version the engine just shipped.
// Replaced at workflow time by the materialize step's __VERSION__ rewrite.
export const version: string = '__VERSION__';
export const canary: boolean = true;
