// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**', '*.vsix'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      curly: 'error',
      eqeqeq: ['error', 'always'],
      'no-throw-literal': 'error',
      'no-console': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    // The core layer is plain TypeScript: no VS Code API and no Node built-ins,
    // so it can be unit-tested directly and could run in a web extension host.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'src/core must stay free of VS Code APIs.' },
            ...['fs', 'path', 'os', 'child_process', 'crypto', 'util', 'buffer', 'process'].map(
              (name) => ({ name, message: 'src/core must not depend on Node built-ins.' }),
            ),
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'src/core must not depend on Node built-ins.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        // used inside puppeteer page.evaluate() callbacks, which run in the browser
        document: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
