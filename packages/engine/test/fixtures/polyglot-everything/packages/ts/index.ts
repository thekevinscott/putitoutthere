// Canary fixture napi entrypoint. The real napi binding would live
// here — at install time npm's resolver picks the matching
// `@putitoutthere/piot-fixture-zzz-cli-napi-<triple>` platform package
// from optionalDependencies and this loader requires it.
export const canary = true;
