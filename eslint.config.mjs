// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'eslint/config';
import eslintPluginImport from 'eslint-plugin-import';
import playwright from 'eslint-plugin-playwright';
import sonarjs from 'eslint-plugin-sonarjs';
import jest from 'eslint-plugin-jest';
import vitest from 'eslint-plugin-vitest';
import jestDom from 'eslint-plugin-jest-dom';
import testingLibrary from 'eslint-plugin-testing-library';
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
    'no-direct-event-dispatch': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow direct event dispatching for user interaction events. Use user-event or proper user interaction simulation.',
        },
        schema: [],
        messages: {
          noDirectEventDispatch:
            'Avoid using dispatchEvent() with {{eventType}} events. Use @testing-library/user-event or simulate user interaction through the DOM.',
        },
      },
      create(context) {
        // User interaction event types that should not be dispatched directly
        const PROBLEMATIC_EVENTS = new Set([
          // Mouse events
          'click',
          'dblclick',
          'mousedown',
          'mouseup',
          'mouseover',
          'mouseout',
          'mousemove',
          'mouseenter',
          'mouseleave',
          // Keyboard events
          'keydown',
          'keyup',
          'keypress',
          // Form events
          'input',
          'change',
          'submit',
          'focus',
          'blur',
        ]);

        const getEventNameFromNewExpression = (node) => {
          // For new MouseEvent('click', {...}), KeyboardEvent('keydown', {...}), etc.
          // the first argument is the event type
          if (node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
              return firstArg.value;
            }
          }

          // For new Event() without type name suffix
          if (node.callee.type === 'Identifier') {
            const eventName = node.callee.name.replace('Event', '');
            return eventName.toLowerCase();
          }

          return null;
        };

        return {
          CallExpression(node) {
            // Check for dispatchEvent calls
            if (node.callee.type !== 'MemberExpression') {
              return;
            }

            const { property } = node.callee;

            if (property.type !== 'Identifier' || property.name !== 'dispatchEvent') {
              return;
            }

            if (node.arguments.length === 0) {
              return;
            }

            const eventArg = node.arguments[0];

            // Check for new Event('click') or new MouseEvent('click')
            if (eventArg.type === 'NewExpression') {
              const eventName = getEventNameFromNewExpression(eventArg);

              if (eventName && PROBLEMATIC_EVENTS.has(eventName.toLowerCase())) {
                context.report({
                  node: eventArg,
                  messageId: 'noDirectEventDispatch',
                  data: { eventType: eventName },
                });
              }
            }

            // Check for pre-created event variables (harder to detect, but we can flag dispatchEvent in general)
            if (eventArg.type === 'Identifier') {
              const variableName = eventArg.name.toLowerCase();

              // If variable name suggests a problematic event type
              for (const problematicEvent of PROBLEMATIC_EVENTS) {
                if (variableName.includes(problematicEvent) || variableName.includes(`${problematicEvent}event`)) {
                  context.report({
                    node: eventArg,
                    messageId: 'noDirectEventDispatch',
                    data: { eventType: problematicEvent },
                  });
                  break;
                }
              }
            }
          },
        };
      },
    },
    'no-implementation-detail-spying': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow spying on prototype methods. Test behavior through public APIs instead.',
        },
        schema: [],
        messages: {
          noPrototypeSpying:
            'Avoid spying on prototype methods ({{className}}.prototype.{{methodName}}). Test behavior through public APIs instead.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            // Check for vi.spyOn(SomeClass.prototype, 'method') or jest.spyOn(SomeClass.prototype, 'method')
            if (node.callee.type !== 'MemberExpression') {
              return;
            }

            const { object, property } = node.callee;

            // Check if it's vi.spyOn or jest.spyOn
            if (object.type !== 'Identifier' || !['vi', 'jest'].includes(object.name)) {
              return;
            }

            if (property.type !== 'Identifier' || property.name !== 'spyOn') {
              return;
            }

            if (node.arguments.length < 2) {
              return;
            }

            const firstArg = node.arguments[0];

            // Check if first argument accesses .prototype
            if (firstArg.type === 'MemberExpression') {
              if (firstArg.property.type === 'Identifier' && firstArg.property.name === 'prototype') {
                const className = firstArg.object.type === 'Identifier'
                  ? firstArg.object.name
                  : '<unknown>';

                const secondArg = node.arguments[1];
                const methodName = secondArg.type === 'Literal' && typeof secondArg.value === 'string'
                  ? secondArg.value
                  : '<unknown>';

                context.report({
                  node: firstArg,
                  messageId: 'noPrototypeSpying',
                  data: { className, methodName },
                });
              }
            }
          },
        };
      },
    },
    'no-prototype-property-binding': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow binding built-in prototype methods. Tests should not need to manipulate prototype methods of built-ins.',
        },
        schema: [],
        messages: {
          noPrototypeBinding:
            'Avoid binding {{constructor}}.prototype.{{method}}. Test behavior differently.',
        },
      },
      create(context) {
        const BUILTIN_PROTOTYPES = new Set([
          'Map',
          'Set',
          'Array',
          'Object',
          'String',
          'Number',
          'Date',
          'RegExp',
        ]);

        return {
          CallExpression(node) {
            // Check for Constructor.prototype.method.bind(instance) pattern
            if (node.callee.type !== 'MemberExpression') {
              return;
            }

            const calleeObject = node.callee.object;

            // Check if it's a .bind() call
            if (node.callee.property.type !== 'Identifier' || node.callee.property.name !== 'bind') {
              return;
            }

            // Check if the object being bound is a prototype property access
            if (calleeObject.type !== 'MemberExpression') {
              return;
            }

            const prototypeObject = calleeObject.object;

            // Check if prototypeObject.prototype is being accessed
            if (prototypeObject.type !== 'MemberExpression') {
              return;
            }

            if (prototypeObject.property.type !== 'Identifier' || prototypeObject.property.name !== 'prototype') {
              return;
            }

            const constructorName = prototypeObject.object.type === 'Identifier'
              ? prototypeObject.object.name
              : null;

            if (constructorName && BUILTIN_PROTOTYPES.has(constructorName)) {
              const methodName = calleeObject.property.type === 'Identifier'
                ? calleeObject.property.name
                : '<unknown>';

              context.report({
                node: calleeObject,
                messageId: 'noPrototypeBinding',
                data: { constructor: constructorName, method: methodName },
              });
            }
          },
        };
      },
    },
    'no-instance-property-deletion': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow deleting instance properties in tests. If you need to delete mock methods, you are testing implementation details.',
        },
        schema: [],
        messages: {
          noInstanceDeletion:
            'Avoid deleting instance properties. If you need to delete mock methods to test the prototype, you are testing implementation details.',
        },
      },
      create(context) {
        return {
          UnaryExpression(node) {
            // Check for delete expressions
            if (node.operator !== 'delete') {
              return;
            }

            const argument = node.argument;

            // Allow deleting properties on test objects/mocks (objects created in test)
            // Flag deleting properties on instances or cast expressions
            if (argument.type === 'MemberExpression') {
              const { object, property } = argument;

              // Check for delete (instance as any).property pattern
              if (argument.type === 'TSAsExpression' || object.type === 'TSAsExpression') {
                context.report({
                  node,
                  messageId: 'noInstanceDeletion',
                });
                return;
              }

              // Flag delete instance.method where instance looks like a class instance
              if (property.type === 'Identifier') {
                context.report({
                  node,
                  messageId: 'noInstanceDeletion',
                });
              }
            }
          },
        };
      },
    },
    'prefer-public-api': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Discourage direct access to module internal properties starting with underscore.',
        },
        schema: [],
        messages: {
          noPrivateProperty:
            'Avoid accessing private property "{{propertyName}}". Use public APIs instead.',
        },
      },
      create(context) {
        return {
          MemberExpression(node) {
            const { property } = node;

            // Check for underscore-prefixed properties
            if (property.type === 'Identifier' && property.name.startsWith('_')) {
              // Allow some common non-private patterns
              const ALLOWED = new Set([
                '_id',
                '_v',
                '__filename',
                '__dirname',
                '_cache',
                '_mockData',
                '_test',
              ]);

              if (ALLOWED.has(property.name)) {
                return;
              }

              context.report({
                node: property,
                messageId: 'noPrivateProperty',
                data: { propertyName: property.name },
              });
            }
          },
        };
      },
    },
    'require-behavior-verification': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Require tests to verify observable behavior, not just mock calls.',
        },
        schema: [],
        messages: {
          onlyMockAssertions:
            'Test only verifies mock calls without checking observable behavior (DOM state, return values, emitted events, or state changes). Add assertions that verify the actual outcome.',
        },
      },
      create(context) {
        // Matchers that indicate behavior verification (good)
        const BEHAVIOR_MATCHERS = new Set([
          // State/value matchers
          'toBe',
          'toEqual',
          'toStrictEqual',
          'toMatch',
          'toMatchObject',
          'toContain',
          'toContainEqual',
          'toHaveLength',
          'toHaveProperty',
          'toBeDefined',
          'toBeUndefined',
          'toBeNull',
          'toBeTruthy',
          'toBeFalsy',
          'toBeGreaterThan',
          'toBeGreaterThanOrEqual',
          'toBeLessThan',
          'toBeLessThanOrEqual',
          'toBeCloseTo',
          'toThrow',
          // DOM-related matchers (jsdom)
          'toHaveTextContent',
          'toHaveAttribute',
          'toHaveValue',
          'toBeChecked',
          'toBeDisabled',
          'toBeEnabled',
          'toBeVisible',
          'toBeInTheDocument',
          'toHaveFocus',
          'toHaveStyle',
          // Async matchers
          'resolves',
          'rejects',
        ]);

        // Matchers that only check implementation (bad)
        const MOCK_ONLY_MATCHERS = new Set([
          'toHaveBeenCalled',
          'toHaveBeenCalledTimes',
        ]);

        const tests = [];

        const enterTest = (node) => {
          tests.push({
            node,
            hasBehaviorAssertion: false,
            hasMockOnlyAssertion: false,
            assertionCount: 0,
          });
        };

        const exitTest = () => {
          const test = tests.at(-1);
          if (!test) {
            return;
          }

          tests.pop();

          // Only report if there are assertions but they're all mock-only
          if (test.assertionCount > 0 && test.hasMockOnlyAssertion && !test.hasBehaviorAssertion) {
            context.report({
              node: test.node,
              messageId: 'onlyMockAssertions',
            });
          }
        };

        const isExpectCall = (node) => {
          if (node.type !== 'CallExpression') {
            return false;
          }

          const { callee } = node;

          // Handle await expect(...)
          if (callee.type === 'AwaitExpression') {
            return false; // await expect(...) - the actual expect is inside
          }

          // Check for expect() as direct callee
          if (callee.type === 'Identifier' && callee.name === 'expect') {
            return true;
          }

          // Check for expect().matcher() pattern
          if (callee.type === 'MemberExpression') {
            const { object } = callee;

            // Check if object is expect() call
            if (object.type === 'CallExpression' && object.callee.type === 'Identifier' && object.callee.name === 'expect') {
              return true;
            }

            // Check for expect.identifier (e.g., expect.resolves, expect.rejects)
            if (object.type === 'Identifier' && object.name === 'expect') {
              return true;
            }
          }

          return false;
        };

        const getAssertionMatcher = (node) => {
          // For expect(x).matcher(...) or expect(x).not.matcher(...)
          // node.callee is the MemberExpression like .matcher or .not.matcher
          const callee = node.callee;

          if (callee.type !== 'MemberExpression') {
            return null;
          }

          // Walk up the chain to find the actual matcher (not, resolves, rejects are modifiers)
          let current = callee;

          while (current && current.type === 'MemberExpression') {
            if (current.property.type === 'Identifier') {
              const name = current.property.name;

              // Check if this is a modifier
              if (name === 'not' || name === 'resolves' || name === 'rejects') {
                current = current.object;
                continue;
              }

              // This is the actual matcher
              return name;
            }

            break;
          }

          return null;
        };

        const checkAssertion = (node) => {
          const test = tests.at(-1);
          if (!test) {
            return;
          }

          test.assertionCount++;

          // Check if the call chain starts with expect()
          if (!isExpectCall(node)) {
            return;
          }

          const matcher = getAssertionMatcher(node);

          if (!matcher) {
            return;
          }

          if (BEHAVIOR_MATCHERS.has(matcher)) {
            test.hasBehaviorAssertion = true;
          }

          if (MOCK_ONLY_MATCHERS.has(matcher)) {
            test.hasMockOnlyAssertion = true;
          }

          // Special case: toHaveBeenCalledWith/LastCalledWith/NthCalledWith verify behavior (arguments)
          if (matcher === 'toHaveBeenCalledWith' || matcher === 'toHaveBeenLastCalledWith' || matcher === 'toHaveBeenNthCalledWith') {
            test.hasBehaviorAssertion = true;
            test.hasMockOnlyAssertion = false;
          }
        };

        return {
          // Enter test functions - use FunctionExpression and ArrowFunctionExpression as selectors
          FunctionExpression(node) {
            // Check if this function is passed to it() or test()
            const parent = node.parent;

            if (parent && parent.type === 'CallExpression') {
              const { callee } = parent;

              // Check if the callee is it() or test()
              if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
                enterTest(node);
              }

              // Also check for test.it(), describe.it() patterns
              if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                if (callee.property.name === 'it' || callee.property.name === 'test') {
                  enterTest(node);
                }
              }
            }
          },
          ArrowFunctionExpression(node) {
            // Check if this arrow function is passed to it() or test()
            const parent = node.parent;

            if (parent && parent.type === 'CallExpression') {
              const { callee } = parent;

              // Check if the callee is it() or test()
              if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
                enterTest(node);
              }

              // Also check for test.it(), describe.it() patterns
              if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                if (callee.property.name === 'it' || callee.property.name === 'test') {
                  enterTest(node);
                }
              }
            }
          },

          // Exit test functions
          'FunctionExpression:exit': (node) => {
            // Check if this is a test we're tracking
            if (tests.length > 0 && tests.at(-1)?.node === node) {
              exitTest();
            }
          },
          'ArrowFunctionExpression:exit': (node) => {
            // Check if this is a test we're tracking
            if (tests.length > 0 && tests.at(-1)?.node === node) {
              exitTest();
            }
          },

          // Check all CallExpressions for expect() calls
          CallExpression(node) {
            // Skip if we're not in a test
            if (tests.length === 0) {
              return;
            }

            checkAssertion(node);
          },
        };
      },
    },
  },
};

const internalPlaywrightPlugin = {
  rules: {
    'no-direct-event-dispatch': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow direct event dispatching for user interaction events in Playwright tests. Use Playwright\'s user interaction methods instead.',
        },
        schema: [],
        messages: {
          noDirectEventDispatch:
            'Avoid using dispatchEvent() with {{eventType}} events in Playwright tests. Use click(), press(), type(), or other user interaction methods instead.',
        },
      },
      create(context) {
        // User interaction event types that should not be dispatched directly
        const PROBLEMATIC_EVENTS = new Set([
          // Mouse events
          'click',
          'dblclick',
          'mousedown',
          'mouseup',
          'mouseover',
          'mouseout',
          'mousemove',
          'mouseenter',
          'mouseleave',
          // Keyboard events
          'keydown',
          'keyup',
          'keypress',
          // Form events
          'input',
          'change',
          'submit',
          'focus',
          'blur',
        ]);

        const getEventNameFromNewExpression = (node) => {
          // For new MouseEvent('click', {...}), KeyboardEvent('keydown', {...}), etc.
          // the first argument is the event type
          if (node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
              return firstArg.value;
            }
          }

          // For new Event() without type name suffix
          if (node.callee.type === 'Identifier') {
            const eventName = node.callee.name.replace('Event', '');
            return eventName.toLowerCase();
          }

          return null;
        };

        return {
          CallExpression(node) {
            // Check for dispatchEvent calls
            if (node.callee.type !== 'MemberExpression') {
              return;
            }

            const { property } = node.callee;

            if (property.type !== 'Identifier' || property.name !== 'dispatchEvent') {
              return;
            }

            if (node.arguments.length === 0) {
              return;
            }

            const eventArg = node.arguments[0];

            // Check for new Event('click') or new MouseEvent('click')
            if (eventArg.type === 'NewExpression') {
              const eventName = getEventNameFromNewExpression(eventArg);

              if (eventName && PROBLEMATIC_EVENTS.has(eventName.toLowerCase())) {
                context.report({
                  node: eventArg,
                  messageId: 'noDirectEventDispatch',
                  data: { eventType: eventName },
                });
              }
            }
          },
        };
      },
    },
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
          noToContainClass:
            'Avoid using toContain() with class names ({{className}}) in Playwright tests. Prefer checking data attributes or element states.',
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

        // Check if a string looks like a CSS class name (e.g., 'blok-tooltip--left', 'my-class')
        const looksLikeClassName = (value) => {
          if (!value || typeof value !== 'string') {
            return false;
          }

          const trimmed = value.trim();

          // Match BEM-style class names or hyphenated class names
          // e.g., 'blok-tooltip--left', 'my-component__element--modifier', 'some-class'
          // Uses [-_]+ to match BEM double dashes/underscores like '--' or '__'
          if (/^[a-zA-Z][a-zA-Z0-9]*(?:[-_]+[a-zA-Z0-9]+)+$/.test(trimmed)) {
            return true;
          }

          return false;
        };

        // Check if this is a toContain() call in an expect chain
        const isToContainWithClassName = (node) => {
          if (node.callee.type !== 'MemberExpression') {
            return null;
          }

          const { property } = node.callee;

          if (property.type !== 'Identifier' || property.name !== 'toContain') {
            return null;
          }

          if (node.arguments.length === 0) {
            return null;
          }

          const arg = node.arguments[0];

          if (arg.type === 'Literal' && typeof arg.value === 'string') {
            if (looksLikeClassName(arg.value)) {
              return arg.value;
            }
          }

          return null;
        };

        return {
          CallExpression(node) {
            // Check for toContain() with class names
            const classNameInToContain = isToContainWithClassName(node);

            if (classNameInToContain) {
              context.report({
                node,
                messageId: 'noToContainClass',
                data: { className: classNameInToContain },
              });

              return;
            }

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

const internalDomPlugin = {
  rules: {
    'no-dataset-assignment': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Disallow using .dataset for setting data attributes. Use .setAttribute() instead.',
        },
        fixable: 'code',
        schema: [],
        messages: {
          noDatasetAssignment:
            'Avoid using .dataset.{{property}} for setting data attributes. Use .setAttribute(\'data-{{kebabProperty}}\', value) instead.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        // Convert camelCase to kebab-case
        const toKebabCase = (str) => {
          return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        };

        // Get the object being accessed (the element before .dataset)
        const getElementExpression = (datasetNode) => {
          if (datasetNode.type !== 'MemberExpression') {
            return null;
          }

          return sourceCode.getText(datasetNode.object);
        };

        return {
          AssignmentExpression(node) {
            // Check if left side is element.dataset.property pattern
            if (node.left.type !== 'MemberExpression') {
              return;
            }

            const { object, property, computed } = node.left;

            // Check if it's accessing .dataset
            if (object.type !== 'MemberExpression') {
              return;
            }

            if (object.property.type !== 'Identifier' || object.property.name !== 'dataset') {
              return;
            }

            // Get the property name being set
            const propertyName = computed
              ? (property.type === 'Literal' ? String(property.value) : null)
              : (property.type === 'Identifier' ? property.name : null);

            if (!propertyName) {
              return;
            }

            const kebabProperty = toKebabCase(propertyName);
            const elementExpr = getElementExpression(object);

            if (!elementExpr) {
              return;
            }

            const valueText = sourceCode.getText(node.right);

            context.report({
              node,
              messageId: 'noDatasetAssignment',
              data: {
                property: propertyName,
                kebabProperty,
              },
              fix(fixer) {
                return fixer.replaceText(
                  node,
                  `${elementExpr}.setAttribute('data-${kebabProperty}', ${valueText})`
                );
              },
            });
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
      '.worktrees/**',
      'eslint.config.mjs',
      '**/*.d.ts',
      'src/components/tools/paragraph/**',
      'dist',
      'public/assets/**',
      '**/public/assets/**',
      'storybook-static/**',
      'docs/**',
      '.worktrees/**',
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
      'prefer-arrow-callback': 'off', // Style-only: syntax preference (arrow vs function in callbacks)
      'prefer-const': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-global-assign': 'error',
      'no-implicit-globals': 'error',
      'func-style': 'off', // Style-only: function declaration vs expression preference
      'no-nested-ternary': 'error',
      'max-depth': ['error', { max: 2 }],
      'one-var': 'off', // Style-only: declaration grouping preference
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
      // Security rules
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-debugger': 'error',
      'no-alert': 'error',
      // Strict type safety rules
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // Additional type safety rules
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-meaningless-void-operator': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/no-unnecessary-type-arguments': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-confusing-non-null-assertion': 'error',
      '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-mixed-enums': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      // Disallow non-null assertions (!) - use proper type guards or nullish coalescing instead
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Prohibit weak types
      '@typescript-eslint/no-explicit-any': 'error',
      // Ban the `object` type and similar weak types
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            object: {
              message: 'Avoid using the `object` type. Use a more specific type or Record<string, unknown> instead.',
              fixWith: 'Record<string, unknown>',
            },
            Function: {
              message: 'Avoid using the `Function` type. Use a specific function signature instead.',
            },
            '{}': {
              message: 'Avoid using the `{}` type. Use `Record<string, unknown>` or a specific interface instead.',
              fixWith: 'Record<string, unknown>',
            },
          },
        },
      ],
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      sonarjs,
      import: eslintPluginImport,
      tailwindcss,
      'internal-dom': internalDomPlugin,
    },
    rules: {
      'max-lines': 'off', // Style-only: file length is organizational preference
      // Prevent .dataset assignment, prefer .setAttribute()
      'internal-dom/no-dataset-assignment': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-identical-expressions': 'error',
      'sonarjs/no-extra-arguments': 'error',
      'sonarjs/no-empty-collection': 'error',
      // Prevent UMD module patterns
      'import/no-amd': 'error',
      'import/no-commonjs': 'error',
      // Import organization and quality
      'import/no-duplicates': 'error',
      'import/no-cycle': 'warn',
      'import/no-extraneous-dependencies': 'error',
      'import/no-self-import': 'error',
      // Style-only rules - disabled
      'import/order': 'off',
      'import/first': 'off',
      'import/newline-after-import': 'off',
      // Tailwind CSS rules - keep only error-catching rules, disable style-only
      'tailwindcss/classnames-order': 'off', // Style-only: class ordering
      'tailwindcss/enforces-negative-arbitrary-values': 'off', // Style-only: prefer -mt-[5px] over mt-[-5px]
      'tailwindcss/enforces-shorthand': 'off', // Style-only: prefer px-2 over pl-2 pr-2
      'tailwindcss/no-arbitrary-value': 'off', // Allow arbitrary values when needed
      'tailwindcss/no-custom-classname': ['warn', {
        // Allow custom classes that follow project conventions
        whitelist: ['blok-.*'],
      }],
      'tailwindcss/no-contradicting-classname': 'error', // Keep: catches bugs (conflicting classes)
      'tailwindcss/no-unnecessary-arbitrary-value': 'error', // Prefer p-4 over p-[16px]
    },
  },

  {
    files: ['test/unit/**/*.ts'],
    plugins: {
      jest,
      vitest,
      'jest-dom': jestDom,
      'testing-library': testingLibrary,
      'internal-unit-test': internalUnitTestPlugin,
      'internal-dom': internalDomPlugin,
    },
    settings: {
      // Disable aggressive reporting for testing-library
      'testing-library/utils-module': 'off',
      'testing-library/custom-renders': 'off',
      'testing-library/custom-queries': 'off',
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
      ...vitest.configs.recommended.rules,
      // Disable strict unsafe-* rules for test files - vitest's vi.fn() and mock utilities
      // cause TypeScript type inference issues that are false positives
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Allow non-null assertions in test files for type narrowing
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Prevent .dataset assignment, prefer .setAttribute()
      'internal-dom/no-dataset-assignment': 'error',
      // Encourage behavior-driven testing
      'internal-unit-test/no-direct-event-dispatch': 'warn',
      'internal-unit-test/no-implementation-detail-spying': 'warn',
      'internal-unit-test/no-prototype-property-binding': 'warn',
      'internal-unit-test/no-instance-property-deletion': 'warn',
      'internal-unit-test/prefer-public-api': 'warn',
      'internal-unit-test/require-behavior-verification': 'warn',
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      // Disable rules that require Jest to be installed (we use Vitest)
      'jest/no-deprecated-functions': 'off',
      // Disable require-hook: vi.mock() MUST be top-level in Vitest (hoisting requirement)
      'jest/require-hook': 'off',
      // Vitest-specific rules
      'vitest/expect-expect': 'off', // Already handled by jest/expect-expect
      'vitest/no-alias-methods': 'off', // Already handled by jest/no-alias-methods
      'vitest/no-conditional-tests': 'warn',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-interpolation-in-snapshots': 'error',
      'vitest/no-mocks-import': 'error',
      'vitest/no-standalone-expect': 'off', // Already handled by jest/no-standalone-expect
      'vitest/prefer-to-be': 'off', // Already handled by jest/prefer-to-be
      'vitest/prefer-to-contain': 'off', // Already handled by jest/prefer-to-contain
      'vitest/prefer-to-have-length': 'off', // Already handled by jest/prefer-to-have-length
      'vitest/require-top-level-describe': 'off', // Already handled by jest/require-top-level-describe
      'vitest/valid-describe-callback': 'off', // Already handled by jest/valid-describe-callback
      'vitest/valid-expect': 'off', // Already handled by jest/valid-expect
      'vitest/valid-title': 'off', // Already handled by jest/valid-title
      // Enforce test structure best practices
      'jest/consistent-test-it': 'off', // Style-only: it() vs test() naming convention
      'jest/valid-describe-callback': 'error',
      'jest/valid-expect': 'error',
      'jest/valid-expect-in-promise': 'error',
      'jest/valid-title': 'error',
      'jest/prefer-lowercase-title': 'off', // Style-only
      // Prevent skipped/focused tests in production
      'jest/no-focused-tests': 'error',
      'jest/no-disabled-tests': 'warn',
      'jest/no-commented-out-tests': 'warn',
      // Enforce assertion best practices
      'jest/expect-expect': 'error',
      'jest/no-conditional-expect': 'error',
      'jest/no-standalone-expect': 'error',
      'jest/prefer-to-be': 'off', // Style-only: matcher idiom preference
      'jest/prefer-to-contain': 'off', // Style-only: matcher idiom preference
      'jest/prefer-to-have-length': 'off', // Style-only: matcher idiom preference
      'jest/prefer-strict-equal': 'warn',
      'jest/prefer-equality-matcher': 'off', // Style-only: matcher idiom preference
      'jest/prefer-comparison-matcher': 'off', // Style-only: matcher idiom preference
      'jest/prefer-expect-assertions': 'off', // Can be too strict
      'jest/prefer-expect-resolves': 'off', // Style-only: await syntax preference
      'jest/prefer-called-with': 'warn',
      'jest/prefer-spy-on': 'warn',
      'jest/prefer-todo': 'off', // Style-only: it.todo() convention
      // Prevent anti-patterns
      'jest/no-alias-methods': 'off', // Style-only: toBeCalled vs toHaveBeenCalled are literal aliases
      'jest/no-duplicate-hooks': 'error',
      'jest/no-export': 'error',
      'jest/no-identical-title': 'error',
      'jest/no-jasmine-globals': 'error',
      'jest/no-mocks-import': 'error',
      'jest/no-test-return-statement': 'error',
      'jest/prefer-hooks-on-top': 'error',
      'jest/prefer-hooks-in-order': 'off', // Style-only: hook declaration ordering convention
      'jest/require-top-level-describe': 'off', // Style-only: organizational convention
      // Enforce test organization
      'jest/max-nested-describe': ['warn', { max: 3 }],
      'jest/max-expects': ['warn', { max: 20 }],
      // Code quality
      // Note: no-deprecated-functions requires Jest to be installed, skipped for Vitest compatibility
      'jest/no-untyped-mock-factory': 'warn',
      'jest/prefer-mock-promise-shorthand': 'off', // Style-only: mockResolvedValue vs mockImplementation syntax
      // require-hook is disabled above (vi.mock() must be top-level in Vitest)
      // jest-dom rules for DOM testing best practices
      'jest-dom/prefer-checked': 'error',
      'jest-dom/prefer-enabled-disabled': 'error',
      'jest-dom/prefer-focus': 'error',
      'jest-dom/prefer-required': 'error',
      'jest-dom/prefer-to-have-attribute': 'off', // Style-only: matcher idiom preference
      'jest-dom/prefer-to-have-text-content': 'off', // Style-only: matcher idiom preference
      'jest-dom/prefer-to-have-value': 'error',
      // testing-library rules for behavior-driven testing
      // Note: These rules apply when using DOM Testing Library utilities
      'testing-library/no-await-sync-events': 'warn',
      'testing-library/no-await-sync-queries': 'warn',
      'testing-library/no-container': 'warn',
      'testing-library/no-debugging-utils': 'warn',
      'testing-library/no-global-regexp-flag-in-query': 'warn',
      'testing-library/no-manual-cleanup': 'warn',
      'testing-library/no-node-access': 'warn',
      'testing-library/no-promise-in-fire-event': 'warn',
      'testing-library/no-wait-for-multiple-assertions': 'warn',
      'testing-library/no-wait-for-side-effects': 'warn',
      'testing-library/no-wait-for-snapshot': 'warn',
      'testing-library/prefer-find-by': 'warn',
      'testing-library/prefer-presence-queries': 'warn',
      'testing-library/prefer-query-by-disappearance': 'warn',
      'testing-library/prefer-user-event': 'off', // Disabled - project uses fireEvent pattern
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
      // Encourage behavior-driven testing
      'internal-playwright/no-direct-event-dispatch': 'warn',
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
      'playwright/no-force-option': 'off',
      // Enforce proper async handling
      'playwright/missing-playwright-await': 'error',
      'playwright/no-useless-await': 'error',
      'playwright/no-unsafe-references': 'error',
      // Enforce test structure best practices
      'playwright/require-top-level-describe': 'off', // Style-only: organizational convention
      'playwright/prefer-hooks-on-top': 'off', // Style-only: hook declaration ordering
      'playwright/prefer-hooks-in-order': 'off', // Style-only: hook declaration ordering
      'playwright/no-duplicate-hooks': 'error',
      'playwright/valid-describe-callback': 'error',
      'playwright/valid-title': 'error',
      'playwright/prefer-lowercase-title': 'off', // Style-only
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
      'playwright/prefer-to-be': 'off', // Style-only: matcher idiom preference
      'playwright/prefer-to-contain': 'off', // Style-only: matcher idiom preference
      'playwright/prefer-to-have-count': 'warn',
      'playwright/prefer-to-have-length': 'off', // Style-only: matcher idiom preference
      'playwright/prefer-strict-equal': 'warn',
      'playwright/prefer-comparison-matcher': 'off', // Style-only: matcher idiom preference
      'playwright/prefer-equality-matcher': 'off', // Style-only: matcher idiom preference
      'playwright/no-useless-not': 'off', // Style-only: double negation simplification
      'playwright/require-to-throw-message': 'warn',
      // Prevent deprecated methods
      'playwright/no-nth-methods': 'warn',
      'playwright/no-get-by-title': 'warn',
      // Enforce test organization
      'playwright/max-nested-describe': 'off', // Style-only: nesting depth convention
      'playwright/max-expects': ['warn', { max: 20 }],
      'playwright/no-nested-step': 'off', // Style-only: organizational convention
      // Code quality
      'playwright/no-unused-locators': 'warn',
      'playwright/expect-expect': ['error', {
        assertFunctionNames: ['expect', 'expectDepth'],
      }],
    },
  },
  {
    files: ['docs/src/**/*.test.{ts,tsx}', 'docs/src/**/*.spec.{ts,tsx}'],
    plugins: {
      jest,
      vitest,
      'jest-dom': jestDom,
      'testing-library': testingLibrary,
      'internal-unit-test': internalUnitTestPlugin,
    },
    settings: {
      'testing-library/utils-module': 'off',
      'testing-library/custom-renders': 'off',
      'testing-library/custom-queries': 'off',
    },
    languageOptions: {
      globals: {
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
      ...vitest.configs.recommended.rules,
      'internal-unit-test/require-behavior-verification': 'warn',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      // Disable strict unsafe-* rules for test files - vitest's expect.extend() with jest-dom
      // matchers causes TypeScript type inference issues that are false positives
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Allow non-null assertions in test files for type narrowing
      '@typescript-eslint/no-non-null-assertion': 'off',
      'vitest/expect-expect': 'off',
      'vitest/no-conditional-tests': 'warn',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-interpolation-in-snapshots': 'error',
      'vitest/no-mocks-import': 'error',
      'vitest/valid-describe-callback': 'error',
      'vitest/valid-expect': 'error',
      'vitest/valid-title': 'error',
      'jest/consistent-test-it': 'off', // Style-only: it() vs test() naming convention
      'jest/valid-describe-callback': 'error',
      'jest/valid-expect': 'error',
      'jest/valid-title': 'error',
      'jest/no-focused-tests': 'error',
      'jest/no-disabled-tests': 'warn',
      'jest/expect-expect': 'error',
      'jest/no-standalone-expect': 'error',
      'testing-library/no-await-sync-events': 'warn',
      'testing-library/no-await-sync-queries': 'warn',
      'testing-library/no-container': 'warn',
      'testing-library/no-debugging-utils': 'warn',
      'testing-library/no-manual-cleanup': 'warn',
      'testing-library/no-node-access': 'warn',
      'testing-library/no-wait-for-multiple-assertions': 'warn',
      'testing-library/no-wait-for-side-effects': 'warn',
      'testing-library/prefer-find-by': 'warn',
      'testing-library/prefer-presence-queries': 'warn',
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
    },
    rules: {
      // Enforce best practices
      'storybook/await-interactions': 'error',
      'storybook/context-in-play-function': 'error',
      'storybook/default-exports': 'error',
      'storybook/hierarchy-separator': 'off', // Style-only
      'storybook/no-redundant-story-name': 'off', // Style-only
      'storybook/prefer-pascal-case': 'off', // Style-only
      'storybook/story-exports': 'error',
      'storybook/use-storybook-expect': 'error',
      'storybook/use-storybook-testing-library': 'error',
      // Relax some rules for stories
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      // Play function steps are handled by Storybook framework
      '@typescript-eslint/no-floating-promises': 'off',
      // Stories may have repeated selectors and test data
      'sonarjs/no-duplicate-string': 'off',
      // Disable max-lines for stories (they can be longer due to multiple variations)
      'max-lines': 'off',
    },
  },
);
