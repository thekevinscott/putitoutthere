import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '../../../dist/cli-bin.js');
const prefix = mkdtempSync(join(tmpdir(), 'piot-npm-build-prefix-'));
const env = { ...process.env, npm_config_prefix: prefix, PATH: `${join(prefix, 'bin')}${delimiter}${process.env.PATH ?? ''}` };
const BUILD = 'node -e "require(\'fs\').writeFileSync(\'build.json\', JSON.stringify([process.env.TARGET, process.env.BUILD, process.env.VERSION]))"';

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'piot-npm-build-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages: ['packages/*']\n");
  for (const name of ['a', 'b']) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({ name, version: '0.0.0', scripts: { build: BUILD } }));
  }
  execFileSync('pnpm', ['install'], { cwd: root, env });
  return root;
}

function npmBuild(root: string): string {
  const args = ['npm-build', '--cwd', root, '--path', 'packages/a', '--target', 'linux-x64-gnu', '--build', 'napi', '--version', '1.2.3'];
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8', env });
}

beforeAll(() => execFileSync('npm', ['install', '-g', 'pnpm@11'], { env }), 240_000);

it('a pnpm workspace member with no lockfile of its own installs with pnpm, frozen, then builds', () => {
  const root = workspace();
  expect(npmBuild(root)).not.toContain('::warning::');
  expect(existsSync(join(root, 'packages/a/package-lock.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(root, 'packages/a/build.json'), 'utf8'))).toEqual(['linux-x64-gnu', 'napi', '1.2.3']);
}, 240_000);

it('a lockfile pnpm refuses as outdated falls back to --no-frozen-lockfile', () => {
  const root = workspace();
  const a = join(root, 'packages/a/package.json');
  writeFileSync(a, JSON.stringify({ ...JSON.parse(readFileSync(a, 'utf8')), dependencies: { b: 'workspace:*' } }));
  expect(npmBuild(root)).toMatch(/^::warning::pnpm-lock\.yaml drift.*--no-frozen-lockfile$/m);
  expect(existsSync(join(root, 'packages/a/node_modules/b'))).toBe(true);
}, 240_000);
