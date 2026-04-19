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
 * Shape handlers see. Optional fields explicitly allow `undefined` so
 * the Zod-parsed `Package` (discriminated union from src/config.ts)
 * assigns cleanly under exactOptionalPropertyTypes.
 */
export interface PackageConfig {
  name: string;
  kind: Kind;
  path: string;
  paths: string[];
  depends_on?: string[] | undefined;
  first_version?: string | undefined;
  smoke?: string | undefined;
  // Handler-specific fields are validated by each handler's Zod schema.
  [key: string]: unknown;
}

/** Shape filled in by #5. */
export interface Config {
  version: 1;
  cadence?: 'immediate' | 'scheduled';
  agents_path?: string;
  packages: PackageConfig[];
}

/** Runtime context passed to every handler call. */
export interface Ctx {
  cwd: string;
  dryRun: boolean;
  log: Logger;
  env: Record<string, string>;
  artifacts: ArtifactStore;
  /**
   * Where `actions/download-artifact@v4` dumped the per-row artifacts.
   * Conventionally `${cwd}/artifacts`. Handlers scan this for the files
   * they need to upload. Optional so local/doctor flows can omit.
   */
  artifactsRoot?: string;
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
