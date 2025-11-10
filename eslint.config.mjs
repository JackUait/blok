import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import cypress from 'eslint-plugin-cypress';
import playwright from 'eslint-plugin-playwright';
import sonarjs from 'eslint-plugin-sonarjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  {
    ignores: [
      'node_modules/**',
      '**/*.d.ts',
      'src/components/tools/paragraph/**',
      'src/polyfills.ts',
    ],
  },
  ...compat.config({
    root: true,
    extends: ['codex/ts'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
      tsconfigRootDir: __dirname,
    },
    globals: {
      Node: true,
      Range: true,
      HTMLElement: true,
      HTMLDivElement: true,
      Element: true,
      Selection: true,
      SVGElement: true,
      Text: true,
      InsertPosition: true,
      PropertyKey: true,
      MouseEvent: true,
      TouchEvent: true,
      KeyboardEvent: true,
      ClipboardEvent: true,
      DragEvent: true,
      Event: true,
      EventTarget: true,
      Document: true,
      NodeList: true,
      File: true,
      FileList: true,
      MutationRecord: true,
      AddEventListenerOptions: true,
      DataTransfer: true,
      DOMRect: true,
      ClientRect: true,
      ArrayLike: true,
      InputEvent: true,
      unknown: true,
      requestAnimationFrame: true,
      navigator: true,
    },
    rules: {
      'jsdoc/require-returns-type': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclaration[kind="let"]',
          message: 'Use const instead of let. If reassignment is needed, refactor to avoid mutation.',
        },
      ],
      'no-param-reassign': ['error', { props: true }],
      'no-global-assign': 'error',
      'no-implicit-globals': 'error',
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'no-nested-ternary': 'error',
      'max-depth': ['error', { max: 2 }],
      'one-var': ['error', 'never'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
    overrides: [
      {
        files: ['*.ts', '*.tsx'],
        parserOptions: {
          project: ['./tsconfig.json'],
          tsconfigRootDir: __dirname,
        },
      },
      {
        files: ['tsconfig.json', 'package.json', 'tsconfig.*.json', 'tslint.json'],
        rules: {
          quotes: [1, 'double'],
          semi: [1, 'never'],
          '@typescript-eslint/consistent-type-imports': 'off',
          '@typescript-eslint/consistent-type-exports': 'off',
        },
      },
    ],
  }),
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      sonarjs,
    },
    rules: {
      // Duplicate code detection
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-identical-expressions': 'error',
    },
  },
  {
    files: ['test/cypress/**/*.ts'],
    plugins: {
      cypress,
    },
    languageOptions: {
      globals: {
        // Cypress/Mocha globals
        describe: 'readonly',
        it: 'readonly',
        context: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        cy: 'readonly',
        Cypress: 'readonly',
        expect: 'readonly',
        assert: 'readonly',
        // Custom globals
        EditorJS: 'readonly',
      },
    },
    rules: {
      ...cypress.configs.recommended.rules,
      'cypress/require-data-selectors': 'error',
      'cypress/no-unnecessary-waiting': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['test/playwright/**/*.ts'],
    plugins: {
      playwright,
    },
    languageOptions: {
      globals: {
        // Playwright globals
        test: 'readonly',
        expect: 'readonly',
        // Custom globals
        EditorJS: 'readonly',
      },
    },
    rules: {
      ...playwright.configs.recommended.rules,
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
