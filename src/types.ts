/**
 * Public SDK + internal handler types.
 *
 * Full contract specified in plan.md §7.1. This file is the scaffolded
 * surface; each field's implementation lands in its own issue:
 * #5 (config), #7 (cascade), #11 (logger), #12 (handler dispatcher),
 * #13 (completeness), #14 (pre-flight), #16–#19 (handlers).
 */

export type Kind = 'crates' | 'pypi' | 'npm';

export type Bump = 'patch' | 'minor' | 'major';

/**
 * Per-target entry in `[[package]].targets`.
 *
 * Bare-string form keeps the historical contract: the planner resolves a
 * GHA runner from the hardcoded triple→runner mapping in `src/plan.ts`.
 * Object form overrides that runner per target — e.g. switching a
 * cross-compiled `aarch64-unknown-linux-gnu` row from `ubuntu-latest`
 * onto the free native `ubuntu-24.04-arm` runner. Issue #159.
 */
export type TargetEntry = string | { triple: string; runner?: string };

/**
 * Normalizes a `TargetEntry` into its canonical object shape. Callers
 * that only need the triple can destructure; callers that drive the CI
 * matrix read `.runner` and fall back to the hardcoded mapping when
 * it's absent.
 */
export function normalizeTarget(entry: TargetEntry): { triple: string; runner?: string } {
  if (typeof entry === 'string') {return { triple: entry };}
  return entry.runner !== undefined
    ? { triple: entry.triple, runner: entry.runner }
    : { triple: entry.triple };
}

/**
 * Shape handlers see. Optional fields explicitly allow `undefined` so
 * the Zod-parsed `Package` (discriminated union from src/config.ts)
 * assigns cleanly under exactOptionalPropertyTypes.
 */
export interface PackageConfig {
  name: string;
  kind: Kind;
  path: string;
  globs: string[];
  depends_on?: string[] | undefined;
  first_version?: string | undefined;
  // Handler-specific fields are validated by each handler's Zod schema.
  [key: string]: unknown;
}

/** Shape filled in by #5. */
export interface Config {
  version: 1;
  packages: PackageConfig[];
}

/** Runtime context passed to every handler call. */
export interface Ctx {
  cwd: string;
  log: Logger;
  env: Record<string, string>;
  artifacts: ArtifactStore;
  /**
   * Where `actions/download-artifact@v4` dumped the per-row artifacts.
   * Conventionally `${cwd}/artifacts`. Handlers scan this for the files
   * they need to upload. Optional so local/doctor flows can omit.
   */
  artifactsRoot?: string;
  /**
   * Working directories of the OTHER packages in this config. The
   * crates handler whitelists these in its pre-publish dirty-workspace
   * check: a polyglot consumer with rust + js packages will have
   * workflow-generated install state (node_modules/, dist/,
   * package-lock.json) inside the js package's path during publish, and
   * cargo can never pack files outside its own package dir, so the
   * dirty-check shouldn't refuse on them. Optional so local/test flows
   * can omit; absent => empty list.
   */
  siblingPackagePaths?: readonly string[];
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface ArtifactStore {
  /** Absolute path to the artifact tree for a given matrix artifact_name. */
  get(artifactName: string): string;
  /** True if the artifact_name exists and is non-empty. */
  has(artifactName: string): boolean;
}

export interface PublishResult {
  status: 'published' | 'already-published' | 'skipped';
  url?: string;
  bytes?: number;
}

export interface SmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  output?: string;
}

export interface Handler {
  kind: Kind;
  isPublished(pkg: PackageConfig, version: string, ctx: Ctx): Promise<boolean>;
  writeVersion(pkg: PackageConfig, version: string, ctx: Ctx): Promise<string[]>;
  publish(pkg: PackageConfig, version: string, ctx: Ctx): Promise<PublishResult>;
  smokeTest?(pkg: PackageConfig, version: string, ctx: Ctx): Promise<SmokeResult>;
}

/** Thrown on auth failure. Not retried. */
export class AuthError extends Error {
  override readonly name = 'AuthError';
}

/** Thrown on 5xx / network / timeout. Retried per §13.3. */
export class TransientError extends Error {
  override readonly name = 'TransientError';
}

/**
 * Diagnostic metadata a handler can attach to a thrown error so the
 * failure renderer (`verbose.ts:dumpFailure`) can surface tool versions
 * and other context without requiring every handler to plumb its own
 * dump call. Phase 2 / Idea 9.
 *
 * Attached via `attachHandlerMeta(err, ...)` and read at the publish
 * boundary via `readHandlerMeta(err)`.
 */
export interface HandlerErrorMeta {
  /** `{tool: "tool --version output"}`. Examples: `twine`, `python`,
   *  `npm`, `cargo`. Capture is best-effort — keys may be absent if
   *  the tool isn't on PATH or its version probe failed. */
  toolVersions?: Record<string, string>;
}

const HANDLER_META_KEY = '__piotHandlerMeta';

/** Attach handler-failure metadata to an Error and return the same
 *  Error (so callers can `throw attachHandlerMeta(new Error(...), {...})`). */
export function attachHandlerMeta<E extends Error>(err: E, meta: HandlerErrorMeta): E {
  (err as E & { [HANDLER_META_KEY]?: HandlerErrorMeta })[HANDLER_META_KEY] = meta;
  return err;
}

/** Read handler-failure metadata from a possibly-Error value. Returns
 *  undefined for non-Error values, plain Errors, and Errors without
 *  attached meta. */
export function readHandlerMeta(value: unknown): HandlerErrorMeta | undefined {
  if (!(value instanceof Error)) {return undefined;}
  const carrier = value as Error & { [HANDLER_META_KEY]?: HandlerErrorMeta };
  return carrier[HANDLER_META_KEY];
}
