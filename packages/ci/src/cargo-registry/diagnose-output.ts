/**
 * Decision core for the cargo-http-registry `diagnose` mode (#454). I/O-free:
 * given the raw registry log (or null when the file is absent), the raw
 * endpoint-probe output, and the raw cargo config (or null), assemble the exact
 * grouped diagnostic dump the "Diagnostic dump (cargo-http-registry)" bash
 * produced. `cat` emits file bytes verbatim (no added newline), so the raw
 * contents are concatenated as-is; the `|| echo` fallbacks become the
 * `(no log)` / `(no config.toml)` lines. Pure; pinned byte-for-byte in
 * `diagnose-output.test.ts`.
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
