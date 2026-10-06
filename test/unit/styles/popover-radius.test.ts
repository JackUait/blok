/**
 * Popover family radius contract (docs/plans/2026-09-30-radius-design-system.md):
 * cards are `surface`, their padding is a space token, and each card publishes
 * --blok-radius-inner from its own role and padding tokens so the rows at its
 * corners are concentric. jsdom has no CSS, so this reads sources.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { css as popoverCss, cssInline as popoverInlineCss } from '../../../src/components/utils/popover/popover.const';
import {
  css as itemCss,
  cssInline as itemInlineCss,
  cssNestedInline as itemNestedInlineCss,
} from '../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const';
import { twMerge } from '../../../src/components/utils/tw';

const ROOT = resolve(__dirname, '../../..');

const readSource = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const popoverAnimation = readSource('src/styles/popover-animation.css');
const field = readSource('src/styles/field.css');
const slashSearch = readSource('src/styles/slash-search.css');

const INNER_ITEM = 'rounded-(--blok-radius-inner,var(--blok-radius-control))';

const inner = (outer: string, ...gaps: string[]): string =>
  `--blok-radius-inner: max(var(--blok-radius-floor), calc(var(--blok-radius-${outer})${gaps.map((gap) => ` - var(${gap})`).join('')}))`;

/** Closing brace index of the block that opens at `open`. */
const blockEnd = (source: string, open: number): number => {
  const STEP: Record<string, number> = { '{': 1, '}': -1 };
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    depth += STEP[source[i]] ?? 0;

    if (depth === 0) {
      return i;
    }
  }

  return source.length;
};

/** Bodies of every top-level rule whose selector text is exactly `selector`, joined. */
const ruleBody = (source: string, selector: string): string => {
  const bodies: string[] = [];
  let found = source.indexOf(`\n${selector} {`);

  while (found >= 0) {
    const open = source.indexOf('{', found + selector.length);
    const close = blockEnd(source, open);

    bodies.push(source.slice(open + 1, close));
    found = source.indexOf(`\n${selector} {`, close);
  }

  expect(bodies.length, `rule ${selector}`).toBeGreaterThan(0);

  return bodies.join('\n');
};

const squash = (value: string): string => value.replace(/\s+/g, ' ');

const ROLE = '--blok-radius-(dialog|surface|block|field|control-lg|control|control-sm|mark|pill|notch)';
const ALLOWED_CLASS = new RegExp(`^rounded-(\\(${ROLE}\\)|\\(--blok-radius-inner,var\\(${ROLE}\\)\\)|full|none)$`);
const ALLOWED_CSS = new RegExp(`^(var\\(${ROLE}\\)|var\\(--blok-radius-inner, var\\(${ROLE}\\)\\)|0|50%|inherit)$`);

const roundedTokens = (source: string): string[] =>
  (source.match(/[\w:[\]&>*=.-]*rounded(?:-\([^\s'"`]*\)|-[\w[\].-]+)?(?=[\s'"`;,]|$)/g) ?? [])
    .map((token) => token.split(':').pop() ?? token)
    .filter((token) => token.startsWith('rounded'));

describe('popover card', () => {
  it('draws its corner in CSS only, as surface, and publishes the inner radius for 4px padding', () => {
    const body = squash(ruleBody(popoverAnimation, '[data-blok-popover-container]'));

    expect(body).toContain('border-radius: var(--blok-radius-surface);');
    expect(body).toContain(`${inner('surface', '--blok-space-1')};`);

    for (const classes of [popoverCss.popoverContainer, popoverCss.popoverContainerMobile, popoverInlineCss.popoverContainer]) {
      expect(roundedTokens(classes)).toEqual([]);
    }
  });

  it('pads 4px with the same token the inner radius subtracts', () => {
    expect(popoverCss.popoverContainerOpened.split(' ')).toContain('px-(--blok-space-1)');
    expect(popoverCss.items.split(' ')).toEqual(expect.arrayContaining(['pt-(--blok-space-1)', 'pb-(--blok-space-1)']));
    expect(popoverCss.popoverContainerOpened).not.toMatch(/\bpx-1\.5\b/);
    expect(popoverCss.items).not.toMatch(/\bp[tb]-1\.5\b/);
  });

  it('inline toolbar card pads 8px and publishes the floor for its children', () => {
    expect(popoverInlineCss.popoverContainerOpened.split(' ')).toEqual(
      expect.arrayContaining(['px-(--blok-space-2)', 'pt-(--blok-space-2)', 'pb-(--blok-space-2)'])
    );

    const body = squash(ruleBody(popoverAnimation, '[data-blok-popover-inline] > [data-blok-popover-container]'));

    expect(body).toContain(`${inner('surface', '--blok-space-2')};`);
  });

  it('block settings, convert and dense menus publish the inner radius for their smallest corner gap', () => {
    const selector = ':is([data-blok-testid=\'block-tunes-popover\'] > [data-blok-popover-container], [data-blok-popover-dense] > [data-blok-popover-container], [data-blok-popover-container]:has(> [data-blok-popover-items] > [data-blok-convert-item]:not([data-blok-promoted-item])))';
    const body = squash(ruleBody(popoverAnimation, selector));

    // Same 4px inset as the default card, so rows stay at 6 (10 − 4).
    expect(body).toContain('padding-inline: var(--blok-space-1);');
    expect(body).toContain(`${inner('surface', '--blok-space-1')};`);
    // The rows take the inner radius from the shared item class, not a second rule.
    expect(body).not.toContain('border-radius');
  });

  it('the search field at a card corner follows the card', () => {
    const body = squash(ruleBody(popoverAnimation, '[data-blok-popover-container] > [data-blok-field]'));

    expect(body).toContain('border-radius: var(--blok-radius-inner, var(--blok-radius-field));');
  });
});

describe('popover items', () => {
  it('every item variant resolves to the inner radius with a control fallback', () => {
    expect(roundedTokens(itemCss.item)).toEqual([INNER_ITEM]);
    expect(roundedTokens(itemInlineCss.item)).toEqual([]);
    expect(roundedTokens(itemNestedInlineCss.item)).toEqual([]);
    expect(roundedTokens(twMerge(itemCss.item, itemInlineCss.item))).toEqual([INNER_ITEM]);
    expect(roundedTokens(twMerge(itemCss.item, itemNestedInlineCss.item))).toEqual([INNER_ITEM]);
  });
});

describe('inline tool button (api.styles.inlineToolButton)', () => {
  it('sits in the inline toolbar card like its own items', () => {
    const main = readSource('src/styles/main.css');

    const body = squash(ruleBody(main, '@utility blok-inline-tool-button'));

    expect(body).toContain('border-radius: var(--blok-radius-inner, var(--blok-radius-control));');
    expect(roundedTokens(body)).toEqual([]);
  });
});

describe('field and slash search', () => {
  it('a field is the field role when it stands alone', () => {
    expect(squash(ruleBody(field, '[data-blok-field]'))).toContain('border-radius: var(--blok-radius-field);');
  });

  it('the slash pill is a control and the scrollbar thumb is a pill', () => {
    expect(roundedTokens(slashSearch)).toEqual([
      'rounded-(--blok-radius-control)',
      'rounded-(--blok-radius-control)',
    ]);
    expect(squash(ruleBody(slashSearch, '[data-blok-popover-scrollbar]'))).toContain('border-radius: var(--blok-radius-pill);');
  });
});

describe('popover family sources use only radius roles', () => {
  const TS_FILES = [
    'src/components/utils/popover/popover.const.ts',
    'src/components/utils/popover/popover-desktop.ts',
    'src/components/utils/popover/popover-mobile.ts',
    'src/components/utils/popover/popover-inline.ts',
    'src/components/utils/popover/popover-abstract.ts',
    'src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts',
    'src/components/inline-tools/inline-tool-link.ts',
    'src/components/inline-tools/inline-tool-equation.ts',
    'src/components/utils/tooltip.ts',
    'src/components/utils/link-hover-card.ts',
  ];

  it.each(TS_FILES)('%s has no arbitrary, bare or Tailwind-scale rounded class', (file) => {
    const bad = roundedTokens(readSource(file)).filter((token) => !ALLOWED_CLASS.test(token));

    expect(bad).toEqual([]);
  });

  it.each(['src/styles/popover-animation.css', 'src/styles/field.css', 'src/styles/slash-search.css'])(
    '%s radii are role tokens',
    (file) => {
      const values = [...readSource(file).matchAll(/border-radius:\s*([^;]+);/g)].map((match) => squash(match[1].trim()));

      expect(values.filter((value) => !ALLOWED_CSS.test(value))).toEqual([]);
    }
  );

  it('the tooltip is a control and the link hover card is a surface', () => {
    expect(roundedTokens(readSource('src/components/utils/tooltip.ts'))).toEqual(['rounded-(--blok-radius-control)']);
    expect(roundedTokens(readSource('src/components/utils/link-hover-card.ts'))).toEqual([
      INNER_ITEM,
      'rounded-(--blok-radius-surface)',
    ]);
  });
});
