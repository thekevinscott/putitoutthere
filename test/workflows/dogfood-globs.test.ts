/**
 * Self-config glob-coverage invariant.
 *
 * For each `globs` entry in this repo's `putitoutthere.toml`, derive
 * a representative file path that matches the pattern, touch that
 * file in a temp repo seeded with the same config, and assert
 * `plan()` cascades the `putitoutthere` package. The structural
 * regression cover for two failure modes that bit us in two days:
 *
 *  - PR #258 caught the fact that `release.yml` wasn't in `globs`,
 *    so the v0.1.51 release never picked up that fix.
 *  - PR #262 caught that `release-npm.yml` and `putitoutthere.toml`
 *    weren't either — the trailer-forward fix from #261 sat
 *    dormant on main because its diff matched no glob.
 *
 * Both gaps were silent: the publish job's gate skipped publish on
 * an empty cascade and the workflow went green. This test fires
 * before merge if a glob entry stops matching its intended files,
 * or if a new file class needs a glob entry.
 *
 * Note: the test walks the *actual* config file, not a copy. Adding
 * a new glob entry automatically extends coverage; removing one
 * shrinks it. The test asserts the contract every entry must hold:
 * "touching a file at this pattern cascades the package."
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';

import { plan } from '../../src/plan.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const projectTomlText = readFileSync(join(repoRoot, 'putitoutthere.toml'), 'utf8');

interface ProjectConfig {
  package: Array<{
    name: string;
    kind: string;
    path: string;
    globs: string[];
    tag_format?: string;
    first_version?: string;
  }>;
}

const config = parseToml(projectTomlText) as unknown as ProjectConfig;
const pkg = config.package[0]!;
const firstVersion = pkg.first_version ?? '0.1.0';

/**
 * Map a glob entry to a representative file path it must match.
 *
 * Static paths (no glob chars) are used verbatim. `**` is replaced
 * with a synthetic directory, and `*` with a synthetic basename
 * fragment. The minimatch matcher the engine uses must accept the
 * resulting path; if a future glob shape doesn't fit this mapping,
 * extend `representativePath` rather than reach for a regex on the
 * raw glob.
 */
function representativePath(glob: string): string {
  if (!/[*?[]/.test(glob)) return glob;
  if (glob.includes('**')) {
    // `src/**/*.ts` → `src/cascade-test-dir/cascade-test.ts`
    // `dist-action/**` → `dist-action/cascade-test-dir/cascade-test`
    let out = glob.replace(/\*\*/g, 'cascade-test-dir');
    out = out.replace(/\*/g, 'cascade-test');
    // A trailing `/cascade-test-dir` (from `**` at the end with no
    // suffix) needs a final basename so the path lands on a file,
    // not a directory.
    if (out.endsWith('cascade-test-dir')) {
      out = `${out}/cascade-test`;
    }
    return out;
  }
  return glob.replace(/\*/g, 'cascade-test');
}

let repo: string;

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

function setupRepo(): void {
  repo = mkdtempSync(join(tmpdir(), 'self-globs-'));
  // Mirror this repo's config + the minimum scaffolding the engine
  // needs to load it (an npm package needs a package.json under
  // pkg.path; pkg.path is "." here).
  writeFileSync(join(repo, 'putitoutthere.toml'), projectTomlText, 'utf8');
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({
      name: pkg.name,
      version: '0.0.0',
      repository: { type: 'git', url: 'https://example.invalid' },
    }),
    'utf8',
  );
  writeFileSync(join(repo, 'README.md'), 'init\n', 'utf8');
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial']);
  // Tag at the previous version so subsequent commits diff against
  // it. The default `tag_format` is `{name}-v{version}`.
  git(['tag', `${pkg.name}-v${firstVersion}`]);
}

describe('putitoutthere.toml self-config: every glob entry cascades the package on touch', () => {
  it.each(pkg.globs)('"%s" cascades putitoutthere when a matching file changes', async (glob) => {
    setupRepo();
    const filePath = representativePath(glob);
    const fullPath = join(repo, filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    // For files that already exist (notably the actual `putitoutthere.toml`
    // we copied in setupRepo), append rather than overwrite — the engine's
    // plan() reloads the config every call, and corrupting it here would
    // mask the cascade behavior we're trying to assert. A `#` comment is
    // valid in TOML and YAML; the other existing files (README.md,
    // package.json) aren't parsed at plan time, so the appended bytes
    // are harmless even when they aren't valid syntax for that file's
    // format.
    if (existsSync(fullPath)) {
      appendFileSync(fullPath, '\n# cascade-trigger\n', 'utf8');
    } else {
      writeFileSync(fullPath, 'cascade-trigger\n', 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', `touch ${filePath}\n\nrelease: minor`]);

    const matrix = await plan({ cwd: repo });
    const got = matrix.find((r) => r.name === pkg.name);
    expect(
      got,
      `glob "${glob}" did not cascade "${pkg.name}". Touched: ${filePath}. ` +
        `Matrix returned: ${JSON.stringify(matrix)}`,
    ).toBeDefined();
  });
});
