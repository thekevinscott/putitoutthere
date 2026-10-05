/**
 * Decision core for the cargo-http-registry `diagnose` mode (#454). I/O-free:
 * assembles the grouped dump the "Diagnostic dump (cargo-http-registry)" bash
 * produced. `cat` emits file bytes verbatim (no added newline), so raw contents
 * are concatenated as-is; the `|| echo` fallbacks become the `(no …)` lines.
 */

export interface DiagnoseOutputInput {
  logRaw: string | null;
  probeRaw: string;
  configRaw: string | null;
}

export function diagnoseOutput(input: DiagnoseOutputInput): string {
  return (
    '::group::cargo-http-registry log\n' +
    (input.logRaw === null ? '(no log)\n' : input.logRaw) +
    '::endgroup::\n' +
    '::group::endpoint probe\n' +
    input.probeRaw +
    '::endgroup::\n' +
    '::group::~/.cargo/config.toml\n' +
    (input.configRaw === null ? '(no config.toml)\n' : input.configRaw) +
    '::endgroup::\n'
  );
}
