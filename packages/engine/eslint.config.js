import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

// #469 async-migration ratchet: files still using sync I/O. Entries may
// only be DELETED (by the sub-issue that migrates them), never added.
const SYNC_EXEMPT = [
  'src/check-crate-size.ts', 'src/check.ts', 'src/cli.ts', 'src/completeness.ts',
  'src/config.ts', 'src/find-workspace-root.ts', 'src/glob.ts',
  'src/handlers/crates.ts', 'src/handlers/npm-platform.ts', 'src/handlers/npm.ts',
  'src/handlers/pypi.ts', 'src/normalize-artifacts.ts', 'src/preflight.ts',
  'src/python-versions.ts', 'src/utils/list-files-recursive.ts',
  'src/verbose.ts', 'src/verify/bundle-cli/index.ts',
  'src/verify/bundle-cli/read-python-source.ts', 'src/verify/crate/extract-crate.ts',
  'src/verify/crate/find-crate-file.ts', 'src/verify/crate/index.ts',
  'src/verify/npm-tarball/download.ts', 'src/verify/npm-tarball/local-dir-state.ts',
  'src/verify/npm-tarball/main.ts', 'src/verify/npm-tarball/resolve-url.ts',
  'src/verify/npm-tarball/triple.ts', 'src/verify/wheel/find-dist-file.ts',
  'src/verify/wheel/index.ts', 'src/verify/wheel/read-wheel-version.ts',
  'src/wheel-abi.ts', 'src/write-crate-version.ts', 'src/write-launcher.ts',
  'src/write-resolved-cargo-version.ts', 'src/write-version.ts',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-action/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Always require semicolons. `semi` is a deprecated core rule (removed in
      // ESLint v11); @stylistic is the maintained, TS-aware home for it.
      '@stylistic/semi': ['error', 'always'],
      // Always require braces around control-statement bodies.
      curly: ['error', 'all'],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'node:fs', importNames: ['readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'cpSync', 'chmodSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'renameSync', 'copyFileSync', 'realpathSync', 'openSync', 'unlinkSync', 'accessSync', 'symlinkSync'], message: 'Sync fs is banned in src/ (#469). Use node:fs/promises.' },
          { name: 'node:child_process', importNames: ['execFileSync', 'execSync', 'spawnSync'], message: 'Sync subprocess calls are banned in src/ (#469). Use the exec seam (src/utils/exec-capture.ts / exec-inherit.ts).' },
        ],
      }],
    },
  },
  {
    files: SYNC_EXEMPT,
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Tests routinely reference method references (e.g.
      // `expect(handler.publish).toHaveBeenCalled()`) without calling
      // them; the `this`-binding concern this rule guards against
      // doesn't apply to vitest mocks.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
