import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import eslintPluginImport from 'eslint-plugin-import';
import playwright from 'eslint-plugin-playwright';
import sonarjs from 'eslint-plugin-sonarjs';
import jest from 'eslint-plugin-jest';

const CLASS_SELECTOR_PATTERN = /(^|\s|[>+~,])\.[_a-zA-Z][_a-zA-Z0-9-]*/;
const CLASS_SELECTOR_START_PATTERN = /^\s*\.[_a-zA-Z][_a-zA-Z0-9-]*/;
const CSS_ENGINE_PATTERN = /^css(?::(light|dark))?=\s*.*\.[_a-zA-Z][_a-zA-Z0-9-]*/;
const SELECTOR_METHODS = new Set([
  '$',
  '$$',
  '$eval',
  '$$eval',
  'locator',
  'click',
  'dblclick',
  'hover',
  'focus',
  'tap',
  'press',
  'fill',
  'type',
  'check',
  'uncheck',
  'setInputFiles',
  'selectOption',
  'waitForSelector',
  'isVisible',
  'isHidden',
  'isEnabled',
  'isDisabled',
  'isEditable',
  'isChecked',
  'dragTo',
  'dispatchEvent',
]);
const NON_CSS_PREFIXES = [
  'text=',
  'role=',
  'xpath=',
  'xpath:',
  'id=',
  'data-testid=',
  'data-test=',
  'data-qa=',
  'nth=',
  'aria/',
];

const internalPlaywrightPlugin = {
  rules: {
    'no-classname-selectors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow CSS class selectors in Playwright E2E tests.',
        },
        schema: [],
        messages: {
          noClassSelector:
            'Avoid using CSS class selectors in Playwright tests. Prefer role- or data-based locators.',
        },
      },
      create(context) {
        const getMethodName = (callee) => {
          if (!callee) {
            return null;
          }

          if (callee.type === 'Identifier') {
            return callee.name;
          }

          if (callee.type === 'MemberExpression') {
            if (callee.computed) {
              if (callee.property.type === 'Literal' && typeof callee.property.value === 'string') {
                return callee.property.value;
              }

              return null;
            }

            if (callee.property.type === 'Identifier') {
              return callee.property.name;
            }
          }

          return null;
        };

        const getStaticStringValue = (node) => {
          if (!node) {
            return null;
          }

          if (node.type === 'Literal' && typeof node.value === 'string') {
            return node.value;
          }

          if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
            return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
          }

          return null;
        };

        const usesClassSelector = (rawSelector) => {
          if (!rawSelector) {
            return false;
          }

          const selector = rawSelector.trim();

          if (!selector) {
            return false;
          }

          const segments = selector.split('>>').map((segment) => segment.trim()).filter(Boolean);
          const segmentsToCheck = segments.length > 0 ? segments : [selector];

          return segmentsToCheck.some((segment) => {
            const lowered = segment.toLowerCase();

            if (NON_CSS_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
              return false;
            }

            if (CSS_ENGINE_PATTERN.test(segment)) {
              const cssValue = segment.replace(/^css(?::(light|dark))?=/i, '').trim();

              return (
                CLASS_SELECTOR_START_PATTERN.test(cssValue) || CLASS_SELECTOR_PATTERN.test(cssValue)
              );
            }

            return (
              CLASS_SELECTOR_START_PATTERN.test(segment) ||
              CLASS_SELECTOR_PATTERN.test(segment)
            );
          });
        };

        return {
          CallExpression(node) {
            const methodName = getMethodName(node.callee);

            if (!methodName || !SELECTOR_METHODS.has(methodName)) {
              return;
            }

            if (node.arguments.length === 0) {
              return;
            }

            const selectorValue = getStaticStringValue(node.arguments[0]);

            if (!selectorValue) {
              return;
            }

            if (usesClassSelector(selectorValue)) {
              context.report({
                node: node.arguments[0],
                messageId: 'noClassSelector',
              });
            }
          },
        };
      },
    },
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  {
    ignores: [
      'node_modules/**',
      'eslint.config.mjs',
      '**/*.d.ts',
      'src/components/tools/paragraph/**',
      'src/polyfills.ts',
      'dist',
      'public/assets/**',
      '**/public/assets/**',
    ],
  },
  ...compat.config({
    root: true,
    extends: ['codex/ts'],
    plugins: ['deprecation'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
      project: ['./tsconfig.json'],
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
      globalThis: true,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'IfStatement > BlockStatement > IfStatement',
          message:
            'Nested if statements are not allowed. Consider using early returns or combining conditions.',
        },
        {
          selector: 'IfStatement > IfStatement',
          message:
            'Nested if statements are not allowed. Consider using early returns or combining conditions.',
        },
        {
          selector: 'VariableDeclaration[kind="let"]',
          message: 'Use const instead of let. If reassignment is needed, refactor to avoid mutation.',
        },
        {
          selector: 'Decorator',
          message: 'Decorators are not allowed.',
        },
      ],
      'jsdoc/require-returns-type': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'deprecation/deprecation': 'error',
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
        rules: {
          '@typescript-eslint/no-floating-promises': 'error',
          'no-unused-vars': 'off',
        },
      },
      {
        files: ['tsconfig.json', 'package.json', 'tsconfig.*.json', 'tslint.json'],
        rules: {
          quotes: [1, 'double'],
          semi: [1, 'never'],
          'comma-dangle': 'off',
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
      import: eslintPluginImport,
    },
    rules: {
      // Duplicate code detection
      'sonarjs/no-duplicate-string': ['error', { threshold: 3, ignoreStrings: 'data-testid,data-focused' }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-identical-expressions': 'error',
      // Prevent UMD module patterns
      'import/no-amd': 'error',
      'import/no-commonjs': 'error',
    },
  },
  {
    files: ['test/unit/**/*.ts'],
    plugins: {
      jest,
    },
    languageOptions: {
      globals: {
        // Vitest/Jest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        vitest: 'readonly',
      },
    },
    rules: {
      ...jest.configs.recommended.rules,
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
      'deprecation/deprecation': 'off',
      // Disable rules that require Jest to be installed (we use Vitest)
      'jest/no-deprecated-functions': 'off',
      // Disable require-hook: vi.mock() MUST be top-level in Vitest (hoisting requirement)
      'jest/require-hook': 'off',
      // Enforce test structure best practices
      'jest/consistent-test-it': ['error', { fn: 'it' }],
      'jest/valid-describe-callback': 'error',
      'jest/valid-expect': 'error',
      'jest/valid-expect-in-promise': 'error',
      'jest/valid-title': 'error',
      'jest/prefer-lowercase-title': ['warn', { ignore: ['describe'] }],
      // Prevent skipped/focused tests in production
      'jest/no-focused-tests': 'error',
      'jest/no-disabled-tests': 'warn',
      'jest/no-commented-out-tests': 'warn',
      // Enforce assertion best practices
      'jest/expect-expect': 'error',
      'jest/no-conditional-expect': 'error',
      'jest/no-standalone-expect': 'error',
      'jest/prefer-to-be': 'warn',
      'jest/prefer-to-contain': 'warn',
      'jest/prefer-to-have-length': 'warn',
      'jest/prefer-strict-equal': 'warn',
      'jest/prefer-equality-matcher': 'warn',
      'jest/prefer-comparison-matcher': 'warn',
      'jest/prefer-expect-assertions': 'off', // Can be too strict
      'jest/prefer-expect-resolves': 'warn',
      'jest/prefer-called-with': 'warn',
      'jest/prefer-spy-on': 'warn',
      'jest/prefer-todo': 'warn',
      // Prevent anti-patterns
      'jest/no-alias-methods': 'error',
      'jest/no-duplicate-hooks': 'error',
      'jest/no-export': 'error',
      'jest/no-identical-title': 'error',
      'jest/no-jasmine-globals': 'error',
      'jest/no-mocks-import': 'error',
      'jest/no-test-return-statement': 'error',
      'jest/prefer-hooks-on-top': 'error',
      'jest/prefer-hooks-in-order': 'warn',
      'jest/require-top-level-describe': 'error',
      // Enforce test organization
      'jest/max-nested-describe': ['warn', { max: 3 }],
      'jest/max-expects': ['warn', { max: 20 }],
      // Code quality
      // Note: no-deprecated-functions requires Jest to be installed, skipped for Vitest compatibility
      'jest/no-untyped-mock-factory': 'warn',
      'jest/prefer-mock-promise-shorthand': 'warn',
      // require-hook is disabled above (vi.mock() must be top-level in Vitest)
    },
  },
  {
    files: ['test/playwright/**/*.ts'],
    plugins: {
      playwright,
      'internal-playwright': internalPlaywrightPlugin,
    },
    languageOptions: {
      globals: {
        // Playwright globals
        test: 'readonly',
        expect: 'readonly',
        // Custom globals
        Blok: 'readonly',
      },
    },
    rules: {
      ...playwright.configs.recommended.rules,
      'internal-playwright/no-classname-selectors': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
      'deprecation/deprecation': 'off',
      // Prevent anti-patterns
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-wait-for-selector': 'error',
      'playwright/no-wait-for-navigation': 'error',
      'playwright/no-element-handle': 'error',
      'playwright/no-page-pause': 'error',
      'playwright/no-networkidle': 'error',
      'playwright/no-eval': 'error',
      'playwright/no-force-option': 'warn',
      // Enforce proper async handling
      'playwright/missing-playwright-await': 'error',
      'playwright/no-useless-await': 'error',
      'playwright/no-unsafe-references': 'error',
      // Enforce test structure best practices
      'playwright/require-top-level-describe': 'error',
      'playwright/prefer-hooks-on-top': 'error',
      'playwright/prefer-hooks-in-order': 'warn',
      'playwright/no-duplicate-hooks': 'error',
      'playwright/valid-describe-callback': 'error',
      'playwright/valid-title': 'error',
      'playwright/prefer-lowercase-title': 'warn',
      // Prevent skipped/focused tests in production
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'warn',
      'playwright/no-commented-out-tests': 'warn',
      // Enforce assertion best practices
      'playwright/prefer-web-first-assertions': 'error',
      'playwright/prefer-locator': 'error',
      'playwright/prefer-native-locators': 'warn',
      'playwright/no-standalone-expect': 'error',
      'playwright/no-conditional-expect': 'error',
      'playwright/no-conditional-in-test': 'warn',
      'playwright/valid-expect': 'error',
      'playwright/valid-expect-in-promise': 'error',
      'playwright/prefer-to-be': 'warn',
      'playwright/prefer-to-contain': 'warn',
      'playwright/prefer-to-have-count': 'warn',
      'playwright/prefer-to-have-length': 'warn',
      'playwright/prefer-strict-equal': 'warn',
      'playwright/prefer-comparison-matcher': 'warn',
      'playwright/prefer-equality-matcher': 'warn',
      'playwright/no-useless-not': 'warn',
      'playwright/require-to-throw-message': 'warn',
      // Prevent deprecated methods
      'playwright/no-nth-methods': 'warn',
      'playwright/no-get-by-title': 'warn',
      // Enforce test organization
      'playwright/max-nested-describe': ['warn', { max: 3 }],
      'playwright/max-expects': ['warn', { max: 20 }],
      'playwright/no-nested-step': 'warn',
      // Code quality
      'playwright/no-unused-locators': 'warn',
      'playwright/expect-expect': 'error',
    },
  },
  {
    files: [
      '**/*.test.{ts,tsx,js,jsx}',
      '**/*.spec.{ts,tsx,js,jsx}',
      'test/**/*.ts',
      'tests/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
