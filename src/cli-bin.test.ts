import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('cli-bin', () => {
  const binSource = readFileSync(
    fileURLToPath(new URL('./cli-bin.ts', import.meta.url)),
    'utf8',
  );
  const cliSource = readFileSync(
    fileURLToPath(new URL('./cli.ts', import.meta.url)),
    'utf8',
  );

  it('cli.ts has no top-level entry-point guard (#201)', () => {
    // ncc bundles src/action.ts with src/cli.ts inlined. Any guard that
    // tests `import.meta.url === file://${process.argv[1]}` inside
    // cli.ts would fire before action.ts's guard in the bundled
    // dist-action/index.js and short-circuit the action wrapper.
    expect(cliSource).not.toMatch(/import\.meta\.url\s*===/);
    expect(cliSource).not.toMatch(/process\.argv\[1\]/);
  });

  it('cli-bin.ts owns the CLI entry-point: starts run(process.argv)', () => {
    expect(binSource).toMatch(/^#!\/usr\/bin\/env node/);
    expect(binSource).toMatch(/from '\.\/cli\.js'/);
    expect(binSource).toMatch(/run\(process\.argv\)/);
  });
});
