import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

// #469 async-migration ratchet: files still using sync I/O. Entries may
// only be DELETED (by the sub-issue that migrates them), never added.
const SYNC_EXEMPT = [
  'src/actionlint-idtoken/run.ts', 'src/cargo-registry/read-raw.ts',
  'src/cargo-registry/run-diagnose.ts', 'src/cargo-registry/run-start.ts',
  'src/changelog-check/run.ts', 'src/evidence-check/run.ts',
  'src/fixture-materialize/run.ts', 'src/patch-coverage/run.ts',
  'src/tdd-lint/run.ts', 'src/testpypi-verify/download-sdists.ts',
  'src/testpypi-verify/download-wheels.ts', 'src/testpypi-verify/run-assert.ts',
  'src/testpypi-verify/run-metadata.ts', 'src/testpypi-verify/verify-artifacts.ts',
  'src/verdaccio-auth/run.ts',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
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
      '@stylistic/semi': ['error', 'always'],
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
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
