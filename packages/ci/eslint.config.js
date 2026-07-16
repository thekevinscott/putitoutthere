import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

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
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // The testing-conventions unit-lint gate requires typed pass-through
      // mocks of the exact form `vi.importActual<typeof import('X')>('X')`
      // (an untyped factory trips its untyped-mock check). That inline
      // `import()` type is the one thing `consistent-type-imports` forbids by
      // default, so allow inline type annotations in tests only — `prefer:
      // top-level` still applies, and src/ stays strict.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    },
  },
);
