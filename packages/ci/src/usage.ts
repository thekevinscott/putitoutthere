/** Print `piot-ci` usage to stdout. */
export function printUsage(): void {
  process.stdout.write(
    [
      'piot-ci — putitoutthere repo-internal CI gates',
      '',
      'Usage: piot-ci <command>',
      '',
      'Gates are registered per issue as they are extracted from inline',
      'workflow bash (evidence-check #445, patch-coverage #468, …).',
      '',
    ].join('\n'),
  );
}
