/**
 * Block chrome radii follow the role tokens of the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md): toolbar buttons, the
 * published `@utility` classes, block frames and their corner controls,
 * block highlights, and the small marks inside blocks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HEADER_BUTTON_MATCHED_STYLES,
  HEADER_BUTTON_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
  VIEW_MODE_BUTTON_ACTIVE_STYLES,
  VIEW_MODE_BUTTON_STYLES,
  VIEW_MODE_CONTAINER_STYLES,
} from '../../../src/tools/code/constants';
import { ARROW_STYLES } from '../../../src/tools/toggle/constants';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../..', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const main = read('src/styles/main.css');

/** Body of the first rule whose selector is exactly `selector`. */
const ruleBody = (source: string, selector: string): string => {
  const start = source.indexOf(`\n${selector} {`);

  expect(start, `rule "${selector}" not found`).toBeGreaterThan(-1);

  return source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
};

const radiusOf = (source: string, selector: string): string | null => {
  const match = ruleBody(source, selector).match(/border-radius:\s*([^;]+);/);

  return match === null ? null : match[1].trim();
};

const tokens = (classes: string): string[] => classes.split(/\s+/).filter(Boolean);
const roundedTokens = (classes: string): string[] => tokens(classes).filter((token) => /(^|:)rounded(-|$)/.test(token));

const INNER_OR_CONTROL = 'rounded-(--blok-radius-inner,var(--blok-radius-control))';

describe('published @utility classes', () => {
  it.each([
    ['@utility blok-inline-tool-button', 'var(--blok-radius-inner, var(--blok-radius-control))'],
    ['@utility blok-input', 'var(--blok-radius-field)'],
    ['@utility blok-button', 'var(--blok-radius-control-lg)'],
    ['@utility blok-settings-button', 'var(--blok-radius-control)'],
  ])('%s takes its radius from a role token', (selector, radius) => {
    expect(radiusOf(main, selector)).toBe(radius);
    expect(ruleBody(main, selector)).not.toMatch(/(^|[\s:])rounded(-|\s|;)/);
  });
});

describe('block highlights', () => {
  it('the keyboard-focused block and the #anchor arrival pulse use the control role', () => {
    expect(radiusOf(main, '[data-blok-navigation-focused="true"]')).toBe('var(--blok-radius-control)');
    expect(radiusOf(main, '.blok-block--target')).toBe('var(--blok-radius-control)');
  });

  it('the spring-loaded flash on a content wrapper follows the block frame', () => {
    expect(radiusOf(main, '[data-blok-spring-loaded] [data-blok-element-content]'))
      .toBe('var(--blok-radius-frame, var(--blok-radius-control))');
  });

  it('a content wrapper does not inherit its parent block frame', () => {
    expect(ruleBody(main, '[data-blok-element-content]')).toMatch(/--blok-radius-frame:\s*initial;/);
  });

  it('a selected list item uses the control role', () => {
    expect(radiusOf(main, '[data-blok-selected="true"] [data-list-style] [role="listitem"]')).toBe('var(--blok-radius-control)');
  });

  it('drop indicator bars are pills', () => {
    expect(radiusOf(main, '[data-drop-indicator]::before')).toBe('var(--blok-radius-pill)');
    expect(radiusOf(main, '[data-drop-indicator-lead]::after')).toBe('var(--blok-radius-pill)');
  });
});

describe('marks and handles inside blocks', () => {
  it('inline code and the equation being edited use the mark role', () => {
    const preflight = read('src/styles/preflight.css');

    expect(preflight).toMatch(/code:not\(pre code\),[^{]*\{\s*border-radius:\s*var\(--blok-radius-mark\);/);
  });

  it('the checklist checkbox uses the mark role', () => {
    expect(radiusOf(read('src/styles/checklist.css'), '[data-blok-interface] [data-list-style="checklist"] input[type="checkbox"]'))
      .toBe('var(--blok-radius-mark)');
  });

  it('the column resizer bar is a pill', () => {
    expect(radiusOf(read('src/styles/columns.css'), '[data-blok-column-resizer]::before')).toBe('var(--blok-radius-pill)');
  });

  it('the toggle arrow uses the small control role', () => {
    expect(roundedTokens(ARROW_STYLES)).toEqual(['rounded-(--blok-radius-control-sm)']);
  });
});

describe('code block header', () => {
  it('publishes the inner radius for controls at the card corner', () => {
    expect(tokens(HEADER_STYLES)).toContain(
      '[--blok-radius-inner:max(var(--blok-radius-floor),calc(var(--blok-radius-block)_-_1px_-_var(--spacing)*1.5))]'
    );
  });

  it.each([
    ['language button', LANGUAGE_BUTTON_STYLES],
    ['copy button', HEADER_BUTTON_STYLES],
    ['copy button beside the view-mode track', HEADER_BUTTON_MATCHED_STYLES],
  ])('the %s follows the card corner', (_name, classes) => {
    expect(roundedTokens(classes)).toEqual([INNER_OR_CONTROL]);
  });

  it('the view-mode track is a large control that publishes its own inner radius', () => {
    expect(roundedTokens(VIEW_MODE_CONTAINER_STYLES)).toEqual(['rounded-(--blok-radius-control-lg)']);
    expect(tokens(VIEW_MODE_CONTAINER_STYLES)).toContain(
      '[--blok-radius-inner:max(var(--blok-radius-floor),calc(var(--blok-radius-control-lg)_-_1px_-_var(--spacing)*0.5))]'
    );
    expect(roundedTokens(VIEW_MODE_BUTTON_STYLES)).toEqual([INNER_OR_CONTROL]);
    expect(roundedTokens(VIEW_MODE_BUTTON_ACTIVE_STYLES)).toEqual([INNER_OR_CONTROL]);
  });
});

describe('no old radius sources in block chrome files', () => {
  it.each([
    'src/components/modules/toolbar/plus-button.ts',
    'src/components/modules/toolbar/settings-toggler.ts',
    'src/components/modules/toolbar/styles.ts',
    'src/components/block/style-manager.ts',
    'src/tools/stub/index.ts',
    'src/tools/code/constants.ts',
    'src/tools/toggle/constants.ts',
    'src/shared/tool-classes/callout.ts',
    'src/shared/tool-classes/code.ts',
    'src/shared/tool-classes/spacer.ts',
    'src/styles/preflight.css',
    'src/styles/checklist.css',
    'src/styles/columns.css',
  ])('%s', (file) => {
    const source = read(file);

    expect(source).not.toMatch(/rounded-\[/);
    expect(source).not.toMatch(/(^|[\s'":])rounded(-(xs|sm|md|lg|xl|2xl))?(?=[\s'"`,])/m);
    expect(source).not.toMatch(/--blok-radius-(xs|sm|md|lg|xl|md-plus|hairline|none)\b/);
    expect(source).not.toMatch(/border-radius:[^;]*--blok-(space|border-width)-/);
    expect(source).not.toMatch(/border-radius:\s*[\d.]+(px|em|rem)/);
  });
});
