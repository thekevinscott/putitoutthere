import { isAbsolute, resolve } from 'node:path';

export interface ParsedFlags {
  cwd: string;
  config?: string | undefined;
  json: boolean;
  // `status --check`: exit non-zero when the report finds drift, so it
  // can gate CI. Inert on other commands.
  check: boolean;
  // `reconcile --dry-run`: report what would be tagged without writing.
  // Rejected on every other command (see `run`), preserving the #244
  // removal from plan / publish.
  dryRun: boolean;
  // #276 write-version inputs. Optional on the global flags type
  // because they're only meaningful for that subcommand; the dispatch
  // arm validates presence before use.
  path?: string | undefined;
  version?: string | undefined;
  // Manual-release spec for `plan` / `publish`. Forwarded to the
  // planner; absent => normal change-detected planning.
  releasePackages?: string | undefined;
  // `verify npm-tarball` inputs (#443). `matrix` is the plan matrix JSON
  // the workflow already carries; `registry` selects the read target and
  // backoff; `perTriple` switches to synthesized-binary verification.
  matrix?: string | undefined;
  registry?: string | undefined;
  // `verify crate` (#449): the cargo-http-registry disk root the engine
  // published to; `.crate` files are read from here, no fetch.
  registryRoot?: string | undefined;
  // `verify wheel` (#450): the matrix row's target (`sdist` or a wheel
  // triple), selecting the sdist-filename vs wheel-METADATA check.
  // `verify bundle-cli` (#451) reuses it to pick the `.exe` suffix.
  target?: string | undefined;
  // `verify wheel` (#610): the row's manylinux baseline; the wheel
  // filename must carry the matching platform tag. Empty/absent: no
  // tag assertion (the workflow passes `matrix.manylinux` verbatim,
  // which is empty on rows without a baseline).
  manylinux?: string | undefined;
  // `verify bundle-cli` (#451): the `bundle_cli.stage_to` dir and `bin`
  // name; the wheel must contain the binary at `<stage_to>/<bin>`.
  stageTo?: string | undefined;
  bin?: string | undefined;
  build?: string | undefined;
  features?: string | undefined;
  noDefaultFeatures: boolean;
  perTriple: boolean;
  // `fold-bundle` (#446): the bundle commit's subject line
  // (`chore(release): bundle action` vs `chore(v0): bundle action`).
  subject?: string | undefined;
  // `reconcile --expect` (#666): `<name>@<version>` or a JSON array of
  // `{name, version}`, confirmed against the registry's per-version
  // endpoint in place of latest-version discovery. Absent => discovery.
  expect?: string | undefined;
}

export function parseFlags(argv: readonly string[]): ParsedFlags {
  const out: ParsedFlags = {
    cwd: process.cwd(),
    json: false,
    check: false,
    dryRun: false,
    noDefaultFeatures: false,
    perTriple: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // The `?? out.cwd` fallback guards a trailing `--cwd` with no value
    // (`argv[++i]` is then undefined); it keeps the default cwd rather
    // than overwriting it with undefined.
    if (a === '--cwd') {out.cwd = argv[++i] ?? out.cwd;}
    else if (a === '--config') {out.config = argv[++i];}
    else if (a === '--json') {out.json = true;}
    else if (a === '--check') {out.check = true;}
    else if (a === '--path') {out.path = argv[++i];}
    else if (a === '--version') {out.version = argv[++i];}
    else if (a === '--release-packages') {out.releasePackages = argv[++i];}
    else if (a === '--matrix') {out.matrix = argv[++i];}
    else if (a === '--registry') {out.registry = argv[++i];}
    else if (a === '--registry-root') {out.registryRoot = argv[++i];}
    else if (a === '--target') {out.target = argv[++i];}
    else if (a === '--manylinux') {out.manylinux = argv[++i];}
    else if (a === '--subject') {out.subject = argv[++i];}
    else if (a === '--stage-to') {out.stageTo = argv[++i];}
    else if (a === '--bin') {out.bin = argv[++i];}
    else if (a === '--build') {out.build = argv[++i];}
    else if (a === '--features') {out.features = argv[++i];}
    else if (a === '--no-default-features') {out.noDefaultFeatures = true;}
    else if (a === '--per-triple') {out.perTriple = true;}
    else if (a === '--dry-run') {out.dryRun = true;}
    else if (a === '--expect') {out.expect = argv[++i];}
  }
  // Always normalise --cwd to an absolute path. Downstream code joins
  // `cwd` with `artifacts/` to derive paths it then hands to subprocesses
  // (twine, cargo, npm) running with `cwd: ctx.cwd`. If cwd were left
  // relative — e.g. `--cwd fixture-tree` from the JS action — those
  // file paths would resolve as `fixture-tree/fixture-tree/...` from
  // the subprocess's vantage. Anchor here once.
  if (!isAbsolute(out.cwd)) {out.cwd = resolve(out.cwd);}
  return out;
}
