// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'eslint/config';
import eslintPluginImport from 'eslint-plugin-import';
import playwright from 'eslint-plugin-playwright';
import sonarjs from 'eslint-plugin-sonarjs';
import jest from 'eslint-plugin-jest';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import tailwindcss from 'eslint-plugin-tailwindcss';

const CLASS_SELECTOR_PATTERN = /\.[_a-zA-Z][_a-zA-Z0-9-]*/;
const ID_SELECTOR_PATTERN = /#[_a-zA-Z][_a-zA-Z0-9-]*/;
const TAG_SELECTOR_PATTERN = /^(?:div|span|p|a|button|input|form|ul|ol|li|table|tr|td|th|thead|tbody|tfoot|h[1-6]|img|nav|header|footer|main|section|article|aside|label|select|textarea|option|fieldset|legend|iframe|canvas|video|audio|source|svg|path|circle|rect|line|polyline|polygon|ellipse|g|defs|use|symbol|text|tspan|strong|em|b|i|u|s|small|mark|del|ins|sub|sup|code|pre|blockquote|hr|br|figure|figcaption|details|summary|dialog|menu|menuitem|datalist|output|progress|meter|time|address|abbr|cite|dfn|kbd|samp|var|ruby|rt|rp|bdi|bdo|wbr|area|map|track|embed|object|param|picture|portal|slot|template|noscript|script|style|link|meta|base|head|body|html)(?:\s|$|\[|:|>|\+|~|,)/i;
const CSS_COMBINATOR_PATTERN = /(?:^|[^>])\s*>\s*|\s+\+\s+|\s+~\s+/;
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
  'data-blok-testid=',
  'data-blok-test=',
  'data-blok-qa=',
  'nth=',
  'aria/',
];

const internalUnitTestPlugin = {
  rules: {
    'no-class-selectors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow class selectors in unit tests. Prefer data-testid or role-based selectors.',
        },
        schema: [],
        messages: {
          noClassSelector:
            'Avoid using class selectors ({{selector}}) in unit tests. Prefer data-blok-testid or role-based selectors.',
          noClassSelectorTemplate:
            'Avoid using class selectors in unit tests. Template contains "." which likely resolves to a class selector. Prefer data-blok-testid or role-based selectors.',
          noClassListMethod:
            'Avoid using classList.{{method}}() in unit tests. Prefer data-blok-testid or data attributes for state checking.',
          noClassNameProperty:
            'Avoid using .className in unit tests. Prefer data-blok-testid or data attributes for state checking.',
          noGetAttributeClass:
            "Avoid using getAttribute('class') in unit tests. Prefer data-blok-testid or data attributes for state checking.",
          noSetAttributeClass:
            "Avoid using setAttribute('class', ...) in unit tests. Prefer data-blok-testid or data attributes for state checking.",
        },
      },
      create(context) {
        const DOM_SELECTOR_METHODS = new Set([
          'querySelector',
          'querySelectorAll',
          'find',
          'findAll',
          'closest',
          'matches',
          'getElementsByClassName',
        ]);

        const CLASS_LIST_METHODS = new Set([
          'contains',
          'add',
          'remove',
          'toggle',
        ]);

        const containsClassSelector = (rawSelector) => {
          if (!rawSelector) {
            return null;
          }

          const selector = rawSelector.trim();

          if (!selector) {
            return null;
          }

          // Match class selectors like .className, .blok-element--selected
          const classMatch = selector.match(/\.[_a-zA-Z][_a-zA-Z0-9-]*/);

          if (classMatch) {
            return classMatch[0];
          }

          return null;
        };

        const containsTemplateDotExpression = (templateLiteral) => {
          // Check if template has `.${` pattern which indicates class selector with variable
          for (const quasi of templateLiteral.quasis) {
            const value = quasi.value.cooked ?? quasi.value.raw;

            if (value.includes('.')) {
              return true;
            }
          }

          return false;
        };

        const checkSelectorArg = (arg) => {
          if (arg.type === 'Literal' && typeof arg.value === 'string') {
            const classSelector = containsClassSelector(arg.value);

            if (classSelector) {
              context.report({
                node: arg,
                messageId: 'noClassSelector',
                data: { selector: classSelector },
              });
            }
          }

          if (arg.type === 'TemplateLiteral') {
            // Check for static class selectors in template parts
            for (const quasi of arg.quasis) {
              const value = quasi.value.cooked ?? quasi.value.raw;
              const classSelector = containsClassSelector(value);

              if (classSelector) {
                context.report({
                  node: quasi,
                  messageId: 'noClassSelector',
                  data: { selector: classSelector },
                });

                return;
              }
            }

            // Check for dynamic class selectors like `.${css.className}`
            if (containsTemplateDotExpression(arg)) {
              context.report({
                node: arg,
                messageId: 'noClassSelectorTemplate',
              });
            }
          }
        };

        const isClassListAccess = (node) => {
          // Check for element.classList.method() pattern
          if (node.type !== 'MemberExpression') {
            return false;
          }

          const { object } = node;

          if (object.type !== 'MemberExpression') {
            return false;
          }

          const { property: classListProperty } = object;

          return classListProperty.type === 'Identifier' && classListProperty.name === 'classList';
        };

        const isSpyOnClassList = (node) => {
          // Check for vi.spyOn(element.classList, 'method') or jest.spyOn(element.classList, 'method') pattern
          if (node.callee.type !== 'MemberExpression') {
            return null;
          }

          const { object, property } = node.callee;

          // Check if it's vi.spyOn or jest.spyOn
          if (object.type !== 'Identifier' || !['vi', 'jest'].includes(object.name)) {
            return null;
          }

          if (property.type !== 'Identifier' || property.name !== 'spyOn') {
            return null;
          }

          // Check if first argument is element.classList
          if (node.arguments.length < 2) {
            return null;
          }

          const firstArg = node.arguments[0];

          if (firstArg.type !== 'MemberExpression') {
            return null;
          }

          if (firstArg.property.type !== 'Identifier' || firstArg.property.name !== 'classList') {
            return null;
          }

          // Check if second argument is a classList method name
          const secondArg = node.arguments[1];

          if (secondArg.type !== 'Literal' || typeof secondArg.value !== 'string') {
            return null;
          }

          if (CLASS_LIST_METHODS.has(secondArg.value)) {
            return secondArg.value;
          }

          return null;
        };

        const isGetAttributeClass = (node) => {
          // Check for element.getAttribute('class') pattern
          if (node.callee.type !== 'MemberExpression') {
            return false;
          }

          const { property } = node.callee;

          if (property.type !== 'Identifier' || property.name !== 'getAttribute') {
            return false;
          }

          if (node.arguments.length === 0) {
            return false;
          }

          const arg = node.arguments[0];

          return arg.type === 'Literal' && arg.value === 'class';
        };

        const isSetAttributeClass = (node) => {
          // Check for element.setAttribute('class', ...) pattern
          if (node.callee.type !== 'MemberExpression') {
            return false;
          }

          const { property } = node.callee;

          if (property.type !== 'Identifier' || property.name !== 'setAttribute') {
            return false;
          }

          if (node.arguments.length < 2) {
            return false;
          }

          const arg = node.arguments[0];

          return arg.type === 'Literal' && arg.value === 'class';
        };

        return {
          MemberExpression(node) {
            // Check for .className property access
            if (node.property.type === 'Identifier' && node.property.name === 'className') {
              context.report({
                node,
                messageId: 'noClassNameProperty',
              });
            }
          },
          CallExpression(node) {
            // Check for element.getAttribute('class') pattern
            if (isGetAttributeClass(node)) {
              context.report({
                node,
                messageId: 'noGetAttributeClass',
              });

              return;
            }

            // Check for element.setAttribute('class', ...) pattern
            if (isSetAttributeClass(node)) {
              context.report({
                node,
                messageId: 'noSetAttributeClass',
              });

              return;
            }

            // Check for vi.spyOn(element.classList, 'method') pattern
            const spyOnMethod = isSpyOnClassList(node);

            if (spyOnMethod) {
              context.report({
                node,
                messageId: 'noClassListMethod',
                data: { method: spyOnMethod },
              });

              return;
            }

            if (node.callee.type !== 'MemberExpression') {
              return;
            }

            const { property } = node.callee;

            // Check for classList methods
            if (isClassListAccess(node.callee)) {
              if (property.type === 'Identifier' && CLASS_LIST_METHODS.has(property.name)) {
                context.report({
                  node,
                  messageId: 'noClassListMethod',
                  data: { method: property.name },
                });
              }

              return;
            }

            // Check for DOM selector methods
            if (property.type !== 'Identifier' || !DOM_SELECTOR_METHODS.has(property.name)) {
              return;
            }

            if (node.arguments.length === 0) {
              return;
            }

            // For querySelector/querySelectorAll, check first argument
            // For Dom.find/Dom.findAll, check second argument (first is the element)
            const methodName = property.name;
            const argIndex = (methodName === 'find' || methodName === 'findAll') ? 1 : 0;
            const arg = node.arguments[argIndex];

            if (arg) {
              checkSelectorArg(arg);
            }
          },
        };
      },
    },
  },
};

const internalStorybookPlugin = {
  rules: {
    'no-class-selectors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow class selectors and toHaveClass in Storybook stories. Prefer data-testid or role-based locators.',
        },
        schema: [],
        messages: {
          noClassSelector:
            'Avoid using class selectors ({{selector}}) in Storybook stories. Prefer data-blok-testid or role-based locators.',
          noClassAttributeSelector:
            'Avoid using class attribute selectors ({{selector}}) in Storybook stories. Prefer data-blok-testid or role-based locators.',
          noToHaveClass:
            'Avoid using toHaveClass() in Storybook stories. Prefer checking data attributes or element states.',
          noClassListMethod:
            'Avoid using classList.{{method}}() in Storybook stories. Prefer data-blok-testid or data attributes for state checking.',
        },
      },
      create(context) {
        const CLASS_LIST_METHODS = new Set([
          'contains',
          'add',
          'remove',
          'toggle',
        ]);

        const containsClassSelector = (rawSelector) => {
          if (!rawSelector) {
            return null;
          }

          const selector = rawSelector.trim();

          if (!selector) {
            return null;
          }

          // Match class selectors like .className, .blok-element--selected
          const classMatch = selector.match(/\.[_a-zA-Z][_a-zA-Z0-9-]*/);

          if (classMatch) {
            return classMatch[0];
          }

          return null;
        };

        const containsClassAttributeSelector = (rawSelector) => {
          if (!rawSelector) {
            return null;
          }

          const selector = rawSelector.trim();

          if (!selector) {
            return null;
          }

          // Match class attribute selectors like [class="foo"], [class*="bar"], [class^="baz"], [class$="qux"], [class~="quux"]
          const classAttrMatch = selector.match(/\[class(?:[*^$~|]?=)[^\]]+\]/);

          if (classAttrMatch) {
            return classAttrMatch[0];
          }

          return null;
        };

        const isClassListAccess = (node) => {
          // Check for element.classList.method() pattern
          if (node.type !== 'MemberExpression') {
            return false;
          }

          const { object } = node;

          if (object.type !== 'MemberExpression') {
            return false;
          }

          const { property: classListProperty } = object;

          return classListProperty.type === 'Identifier' && classListProperty.name === 'classList';
        };

        return {
          // Check for class selectors in strings
          Literal(node) {
            if (typeof node.value !== 'string') {
              return;
            }

            const classSelector = containsClassSelector(node.value);

            if (classSelector) {
              // Skip if it's a file extension like .ts, .css, etc.
              if (/^\.[a-z]{2,4}$/.test(classSelector)) {
                return;
              }

              context.report({
                node,
                messageId: 'noClassSelector',
                data: { selector: classSelector },
              });

              return;
            }

            const classAttrSelector = containsClassAttributeSelector(node.value);

            if (classAttrSelector) {
              context.report({
                node,
                messageId: 'noClassAttributeSelector',
                data: { selector: classAttrSelector },
              });
            }
          },

          // Check for class selectors in template literals
          TemplateLiteral(node) {
            for (const quasi of node.quasis) {
              const value = quasi.value.cooked ?? quasi.value.raw;
              const classSelector = containsClassSelector(value);

              if (classSelector) {
                // Skip if it's a file extension like .ts, .css, etc.
                if (/^\.[a-z]{2,4}$/.test(classSelector)) {
                  continue;
                }

                context.report({
                  node: quasi,
                  messageId: 'noClassSelector',
                  data: { selector: classSelector },
                });

                return;
              }

              const classAttrSelector = containsClassAttributeSelector(value);

              if (classAttrSelector) {
                context.report({
                  node: quasi,
                  messageId: 'noClassAttributeSelector',
                  data: { selector: classAttrSelector },
                });

                return;
              }
            }
          },

          // Check for toHaveClass and classList methods
          CallExpression(node) {
            if (node.callee.type !== 'MemberExpression') {
              return;
            }

            const { property } = node.callee;

            // Check for toHaveClass usage
            if (property.type === 'Identifier' && property.name === 'toHaveClass') {
              context.report({
                node,
                messageId: 'noToHaveClass',
              });

              return;
            }

            // Check for classList methods
            if (isClassListAccess(node.callee)) {
              if (property.type === 'Identifier' && CLASS_LIST_METHODS.has(property.name)) {
                context.report({
                  node,
                  messageId: 'noClassListMethod',
                  data: { method: property.name },
                });
              }
            }
          },
        };
      },
    },
  },
};

const internalPlaywrightPlugin = {
  rules: {
    'no-css-selectors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow CSS selectors in Playwright E2E tests. Prefer role- or data-attribute-based locators.',
        },
        schema: [],
        messages: {
          noCssSelector:
            'Avoid using CSS selectors in Playwright tests. Prefer getByRole(), getByTestId(), or data-blok-* attribute locators.',
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

        const getSelectorParts = (node) => {
          if (!node) {
            return [];
          }

          if (node.type === 'Literal' && typeof node.value === 'string') {
            return [node.value];
          }

          if (node.type === 'TemplateLiteral') {
            return node.quasis.map((element) => element.value.cooked ?? element.value.raw);
          }

          return [];
        };

        const usesCssSelector = (rawSelector) => {
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

            // Allow pure data-attribute selectors like [data-blok-testid="foo"]
            if (/^\[data-[a-z-]+(?:=["'][^"']*["'])?\]$/.test(segment)) {
              return false;
            }

            // Explicit css= prefix is always a CSS selector
            if (/^css(?::(light|dark))?=/i.test(segment)) {
              return true;
            }

            // Strip attribute selectors to avoid false positives in values
            const stripped = segment.replace(/\[.*?\]/g, '');

            // Check for class selectors (.className)
            if (CLASS_SELECTOR_PATTERN.test(stripped)) {
              return true;
            }

            // Check for ID selectors (#id)
            if (ID_SELECTOR_PATTERN.test(stripped)) {
              return true;
            }

            // Check for tag selectors (div, span, etc.)
            if (TAG_SELECTOR_PATTERN.test(stripped)) {
              return true;
            }

            // Check for CSS combinators (>, +, ~)
            if (CSS_COMBINATOR_PATTERN.test(stripped)) {
              return true;
            }

            return false;
          });
        };

        return {
          CallExpression(node) {
            const methodName = getMethodName(node.callee);

            if (!methodName || !SELECTOR_METHODS.has(methodName)) {
              return;
            }

            const nonSelectorOneArgMethods = new Set(['fill', 'type', 'press', 'check', 'uncheck', 'setInputFiles', 'selectOption']);
            if (nonSelectorOneArgMethods.has(methodName) && node.arguments.length === 1) {
              return;
            }

            if (node.arguments.length === 0) {
              return;
            }

            const selectorParts = getSelectorParts(node.arguments[0]);

            if (selectorParts.length === 0) {
              return;
            }

            if (selectorParts.some((part) => usesCssSelector(part))) {
              context.report({
                node: node.arguments[0],
                messageId: 'noCssSelector',
              });
            }
          },
          VariableDeclarator(node) {
            if (node.id.type !== 'Identifier' || !node.id.name.endsWith('SELECTOR')) {
              return;
            }

            if (!node.init) {
              return;
            }

            const selectorParts = getSelectorParts(node.init);

            if (selectorParts.length === 0) {
              return;
            }

            if (selectorParts.some((part) => usesCssSelector(part))) {
              context.report({
                node: node.init,
                messageId: 'noCssSelector',
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

export default defineConfig(
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
      'storybook-static/**',
    ],
  },
  // TypeScript ESLint base config
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      jsdoc,
    },
    languageOptions: {
      parser: tseslint.parser,
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
      '@typescript-eslint/no-deprecated': 'error',
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
      '@typescript-eslint/no-floating-promises': 'error',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      sonarjs,
      import: eslintPluginImport,
      tailwindcss,
    },
    rules: {
      // Duplicate code detection
      'sonarjs/no-duplicate-string': ['error', { threshold: 3, ignoreStrings: 'data-blok-testid,data-blok-focused,data-blok-opened,data-blok-component' }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-identical-expressions': 'error',
      // Prevent UMD module patterns
      'import/no-amd': 'error',
      'import/no-commonjs': 'error',
      // Tailwind CSS rules
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',
      'tailwindcss/enforces-shorthand': 'warn',
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-contradicting-classname': 'error',
    },
  },
  {
    files: ['test/unit/**/*.ts'],
    plugins: {
      jest,
      'internal-unit-test': internalUnitTestPlugin,
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
      // Prevent class selectors in unit tests
      'internal-unit-test/no-class-selectors': 'error',
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-deprecated': 'off',
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
      'internal-playwright/no-css-selectors': 'error',
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-deprecated': 'off',
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
  // Storybook configuration for story files
  ...storybook.configs['flat/recommended'],
  {
    files: ['**/*.stories.@(ts|tsx|js|jsx|mjs|cjs)'],
    plugins: {
      'internal-storybook': internalStorybookPlugin,
    },
    rules: {
      // Enforce best practices
      'storybook/await-interactions': 'error',
      'storybook/context-in-play-function': 'error',
      'storybook/default-exports': 'error',
      'storybook/hierarchy-separator': 'error',
      'storybook/no-redundant-story-name': 'warn',
      'storybook/prefer-pascal-case': 'error',
      'storybook/story-exports': 'error',
      'storybook/use-storybook-expect': 'error',
      'storybook/use-storybook-testing-library': 'error',
      // Prevent CSS class selectors and toHaveClass in stories
      'internal-storybook/no-class-selectors': 'error',
      // Relax some rules for stories
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      // Play function steps are handled by Storybook framework
      '@typescript-eslint/no-floating-promises': 'off',
      // Stories may have repeated selectors and test data
      'sonarjs/no-duplicate-string': 'off',
    },
  },
);
