/**
 * OIDC trust-policy local validation.
 *
 * `doctor` uses this module to check the locally-knowable structural
 * prerequisites of OIDC trusted publishing:
 *
 *   1. At least one `.github/workflows/*.yml` file invokes either
 *      `putitoutthere publish` (as a `run:` command) or the composite
 *      action `thekevinscott/putitoutthere@...` with a `command:`
 *      input that implies publishing.
 *   2. That workflow's publishing job has `permissions: id-token: write`
 *      and `contents: write` (either job-level or workflow-level).
 *   3. The publishing job has an `environment:` key set. We cannot
 *      validate the *value* against the registry's trust policy — that
 *      requires a registry-policy-read API per registry, which is
 *      deferred (Option C, see follow-up to #162).
 *   4. A clearly-identifiable publish step exists — defends against
 *      edge cases like commented-out steps slipping past (1).
 *
 * The parser is intentionally regex/line-based rather than a full YAML
 * parse: the four checks above all reduce to substring/indentation
 * matches within a single jobs block. Adding a YAML dependency would
 * buy us very little here. If the check set grows beyond this (e.g.
 * "validate the environment value against a registry's trust policy"),
 * revisit.
 *
 * Issue #162 — Option D (locally-knowable checks only).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkflowFile {
  /** Absolute path to the workflow file on disk. */
  path: string;
  /** Basename, e.g. `release.yml`. */
  filename: string;
  /** Full file contents. */
  source: string;
  /** Parsed jobs (best-effort; top-level job keys + their raw bodies). */
  jobs: WorkflowJob[];
  /** Workflow-level `permissions:` block contents (empty if none). */
  workflowPermissions: string;
}

export interface WorkflowJob {
  /** Job key, e.g. `publish`. */
  name: string;
  /** Raw source of just that job block (everything indented under it). */
  source: string;
}

export interface PermissionIssue {
  kind: 'missing-permission';
  workflow: string;
  job: string;
  permission: 'id-token: write' | 'contents: write';
}

export interface EnvironmentIssue {
  kind: 'missing-environment';
  workflow: string;
  job: string;
}

export interface InvocationIssue {
  kind: 'no-publish-step';
  workflow: string;
}

/** Issue: declared `trust_policy.workflow` does not match the workflow we found. */
export interface WorkflowFilenameMismatch {
  kind: 'workflow-filename-mismatch';
  declared: string;
  actual: string;
  /** Where `actual` came from — used to refine the error message. */
  source: 'local-workflow' | 'github-workflow-ref';
}

/** Issue: declared `trust_policy.environment` does not match the workflow. */
export interface EnvironmentMismatch {
  kind: 'environment-mismatch';
  workflow: string;
  declared: string;
  actual: string | null;
}

/**
 * Scan `.github/workflows/*.yml` and `*.yaml` for workflows that invoke
 * `putitoutthere publish` or the composite action in a publish mode.
 *
 * Permissive by design: if a workflow *mentions* piot in any way that
 * looks like publishing, include it. Downstream checks then report
 * specifically. The cost of a false-positive is a spurious pass/fail
 * line in `doctor`; the cost of a false-negative is silently missing
 * the user's real publish workflow.
 */
export function findPublishWorkflows(repoRoot: string): WorkflowFile[] {
  const dir = join(repoRoot, '.github', 'workflows');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const workflows: WorkflowFile[] = [];
  for (const entry of entries) {
    if (!/\.ya?ml$/i.test(entry)) continue;
    const path = join(dir, entry);
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
      /* v8 ignore next 3 -- defensive fallback for an unreadable workflow file (permissions, TOCTOU); can't produce in tests without mocking the fs module. */
    } catch {
      continue;
    }
    if (!looksLikePublishWorkflow(source)) continue;
    workflows.push({
      path,
      filename: entry,
      source,
      jobs: parseJobs(source),
      workflowPermissions: extractTopLevelBlock(source, 'permissions') ?? '',
    });
  }
  return workflows;
}

/**
 * Heuristic filter. Matches:
 *   - a `run:` step that contains `putitoutthere publish`
 *   - `uses: thekevinscott/putitoutthere@...` combined with
 *     `command: publish` somewhere in the file (the composite action
 *     defaults to `plan`, so we only flag explicit `publish`)
 *
 * Also accepts the pre-rename slug `put-it-out-there` so workflows
 * pinned to the old name (still routed via GitHub's redirect) continue
 * to be recognised by `doctor`.
 */
const USES_PIOT_RE = /uses:\s*thekevinscott\/(?:putitoutthere|put-it-out-there)@/;

function looksLikePublishWorkflow(source: string): boolean {
  if (/\bputitoutthere\s+publish\b/.test(source)) return true;
  const usesPiot = USES_PIOT_RE.test(source);
  const commandPublish = /command:\s*['"]?publish['"]?/.test(source);
  return usesPiot && commandPublish;
}

/**
 * Best-effort jobs parser. Finds the top-level `jobs:` block and
 * extracts each direct-child key + its body. We use the two-space
 * indent convention GitHub Actions workflows follow. Workflows that
 * deviate (tabs, four-space) would miss — but `init` emits two-space,
 * which is what we're validating.
 */
export function parseJobs(source: string): WorkflowJob[] {
  const lines = source.split('\n');
  // Find the `jobs:` top-level key (unindented).
  let jobsStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^jobs\s*:\s*$/.test(lines[i]!)) {
      jobsStart = i + 1;
      break;
    }
  }
  if (jobsStart === -1) return [];

  const jobs: WorkflowJob[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (let i = jobsStart; i < lines.length; i++) {
    const line = lines[i]!;
    // Another top-level key ends the jobs block.
    if (/^\S/.test(line) && line.trim().length > 0) break;
    // A direct child job key: exactly 2-space indent + `name:`.
    const match = /^ {2}([A-Za-z_][\w-]*)\s*:\s*$/.exec(line);
    if (match) {
      if (current) jobs.push({ name: current.name, source: current.lines.join('\n') });
      current = { name: match[1]!, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) jobs.push({ name: current.name, source: current.lines.join('\n') });
  return jobs;
}

/**
 * Extract a top-level block's body (everything indented beneath a
 * given unindented key up to the next top-level key). Returns the
 * concatenated indented body, or `null` if the key is absent.
 */
function extractTopLevelBlock(source: string, key: string): string | null {
  const lines = source.split('\n');
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    // Inline form: `permissions: read-all`. Return the inline value.
    if (m[1] && m[1].trim().length > 0) return m[1].trim();
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (/^\S/.test(line) && line.trim().length > 0) break;
      body.push(line);
    }
    return body.join('\n');
  }
  return null;
}

/**
 * Check that the publishing job has (or inherits) the two permissions
 * that OIDC trusted publishing requires. The permissions may be set at
 * workflow level (top-level `permissions:`) and/or job level; this
 * function reports a missing permission only if *neither* scope
 * declares it. `write-all` satisfies both.
 */
export function checkPermissions(workflow: WorkflowFile): PermissionIssue[] {
  const publishJob = findPublishJob(workflow);
  if (publishJob === null) return [];

  const jobPerms = extractBlockFromJob(publishJob.source, 'permissions') ?? '';
  const combined = `${workflow.workflowPermissions}\n${jobPerms}`;

  const issues: PermissionIssue[] = [];
  if (!hasPermission(combined, 'id-token', 'write')) {
    issues.push({
      kind: 'missing-permission',
      workflow: workflow.filename,
      job: publishJob.name,
      permission: 'id-token: write',
    });
  }
  if (!hasPermission(combined, 'contents', 'write')) {
    issues.push({
      kind: 'missing-permission',
      workflow: workflow.filename,
      job: publishJob.name,
      permission: 'contents: write',
    });
  }
  return issues;
}

function hasPermission(block: string, name: string, level: 'write'): boolean {
  // `write-all` shortcut: every scope is `write`.
  if (/\bwrite-all\b/.test(block)) return true;
  const re = new RegExp(`\\b${name}\\s*:\\s*${level}\\b`);
  return re.test(block);
}

/**
 * Return `{ kind: 'missing' }` when the publish job lacks an
 * `environment:` key. Does NOT inspect the value — diff-vs-registry is
 * Option C.
 */
export function checkEnvironment(workflow: WorkflowFile): EnvironmentIssue | null {
  const publishJob = findPublishJob(workflow);
  if (publishJob === null) return null;
  if (hasKeyAtJobLevel(publishJob.source, 'environment')) return null;
  return {
    kind: 'missing-environment',
    workflow: workflow.filename,
    job: publishJob.name,
  };
}

/**
 * Sanity check: confirm the workflow has at least one clearly-
 * identifiable publish step. `findPublishWorkflows` already filters,
 * but this catches weird states like a `run:` that's been edited into
 * a comment while the composite-action `uses:` line still matches.
 */
export function checkPublishInvocation(workflow: WorkflowFile): InvocationIssue | null {
  // Strip comment-only lines and blank lines before matching. A
  // commented-out `run: putitoutthere publish` step shouldn't count.
  const uncommented = workflow.source
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  const hasRunCmd = /\bputitoutthere\s+publish\b/.test(uncommented);
  if (hasRunCmd) return null;

  // Composite-action form with `command: publish` explicitly.
  const usesPiot = USES_PIOT_RE.test(uncommented);
  const commandPublish = /command:\s*['"]?publish['"]?/.test(uncommented);
  if (usesPiot && commandPublish) return null;

  return { kind: 'no-publish-step', workflow: workflow.filename };
}

/* ---------------------- #189: declared diff ---------------------- */

/**
 * Extract the basename (no directory) from a bare or path-shaped string.
 * Normalizes both slash styles so a caller feeding in a
 * `.github/workflows/release.yml` still gets `release.yml` back.
 */
function basename(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/**
 * Compare `trust_policy.workflow` against the filename of the workflow
 * that `findPublishWorkflows` identified. The declaration is always a
 * bare filename (Zod enforces that at parse time); the comparison is
 * case-sensitive. Returns `null` on match.
 */
export function diffWorkflowFilename(
  declared: string,
  workflowFilename: string,
): WorkflowFilenameMismatch | null {
  const actual = basename(workflowFilename);
  if (declared === actual) return null;
  return {
    kind: 'workflow-filename-mismatch',
    declared,
    actual,
    source: 'local-workflow',
  };
}

/**
 * Compare `trust_policy.environment` against the workflow's job-level
 * `environment:` value. Absence of a declared environment is not an
 * error — the caller decides whether to invoke this. Returns `null` on
 * match.
 */
export function diffEnvironment(
  declared: string,
  workflow: WorkflowFile,
): EnvironmentMismatch | null {
  const actual = extractJobEnvironment(workflow);
  if (actual === declared) return null;
  return {
    kind: 'environment-mismatch',
    workflow: workflow.filename,
    declared,
    actual,
  };
}

/**
 * Read `process.env.GITHUB_WORKFLOW_REF` (populated by GitHub Actions)
 * and parse out the workflow filename. Shape:
 *
 *   `owner/repo/.github/workflows/release.yml@refs/heads/main`
 *
 * Returns `null` when the env var is absent (we're not running inside
 * Actions) OR when the value doesn't parse — we'd rather neutral-skip
 * the check than false-positive on an unexpected shape.
 */
export function inferFromGithubWorkflowRef(
  env: NodeJS.ProcessEnv = process.env,
): { workflow: string; repository: string } | null {
  const ref = env.GITHUB_WORKFLOW_REF;
  if (ref === undefined || ref.length === 0) return null;
  // Strip the `@ref` suffix, then match
  // `<owner>/<repo>/.github/workflows/<file>`.
  const atIdx = ref.indexOf('@');
  const pathPart = atIdx === -1 ? ref : ref.slice(0, atIdx);
  const m = /^([^/\s]+\/[^/\s]+)\/\.github\/workflows\/(.+)$/.exec(pathPart);
  if (!m) return null;
  return { repository: m[1]!, workflow: m[2]! };
}

/**
 * Extract the job-level `environment:` value from a workflow's publish
 * job. Supports the inline form (`environment: release`) and the nested
 * form (`environment:\n  name: release`). Returns `null` when no
 * environment is declared (or no publish job is found).
 */
function extractJobEnvironment(workflow: WorkflowFile): string | null {
  const publishJob = findPublishJob(workflow);
  /* v8 ignore next -- caller only invokes this for workflows that have a publish job */
  if (publishJob === null) return null;
  const raw = extractBlockFromJob(publishJob.source, 'environment');
  if (raw === null) return null;
  const trimmed = raw.trim();
  // Inline form: `environment: release`. Nested form: `environment:\n  name: release`.
  // The inline regex matches when the value is a single line; for nested
  // blocks, look for the `name:` key inside the body. When neither
  // matches the block is structurally malformed — null propagates.
  if (!trimmed.includes('\n')) {
    const inline = /^['"]?([^'"\n]+?)['"]?$/.exec(trimmed);
    return inline ? inline[1]!.trim() : null;
  }
  const nested = /^\s*name\s*:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(trimmed);
  return nested ? nested[1]!.trim() : null;
}

/* ---------------------------- helpers ---------------------------- */

/**
 * Pick the job within a workflow that runs publish. If only one job
 * matches, return it. If multiple match, prefer the one whose name
 * contains `publish`; otherwise return the first.
 */
function findPublishJob(workflow: WorkflowFile): WorkflowJob | null {
  const matches = workflow.jobs.filter((j) => jobRunsPublish(j));
  if (matches.length === 0) return null;
  const named = matches.find((j) => /publish/i.test(j.name));
  return named ?? matches[0]!;
}

function jobRunsPublish(job: WorkflowJob): boolean {
  if (/\bputitoutthere\s+publish\b/.test(job.source)) return true;
  const usesPiot = USES_PIOT_RE.test(job.source);
  const commandPublish = /command:\s*['"]?publish['"]?/.test(job.source);
  return usesPiot && commandPublish;
}

/**
 * Whether the given job's source declares the key at the job scope
 * (exactly 4-space indent, matching the 2-space job indent + one level
 * further). Inline or block form both accepted.
 */
function hasKeyAtJobLevel(jobSource: string, key: string): boolean {
  const re = new RegExp(`^ {4}${key}\\s*:`, 'm');
  return re.test(jobSource);
}

/**
 * Extract a nested block from inside a job source — `permissions:` or
 * `environment:` below the 4-space indent.
 */
function extractBlockFromJob(jobSource: string, key: string): string | null {
  const lines = jobSource.split('\n');
  const headRe = new RegExp(`^ {4}${key}\\s*:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = headRe.exec(lines[i]!);
    if (!m) continue;
    if (m[1] && m[1].trim().length > 0) return m[1].trim();
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      // Any line indented 4 spaces or less (and non-empty) ends the block.
      if (line.trim().length > 0 && /^ {0,4}\S/.test(line)) break;
      body.push(line);
    }
    return body.join('\n');
  }
  return null;
}
