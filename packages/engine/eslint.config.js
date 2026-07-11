import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

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
