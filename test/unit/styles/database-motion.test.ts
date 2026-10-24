/**
 * Database motion follows the measured Notion timings (research/08 "Motion"),
 * and every piece stands down under prefers-reduced-motion.
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const rules = (css: string): Array<{ selectors: string[]; body: string }> =>
  [ ...css.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .map((rule) => ({ selectors: rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()), body: rule[2] }));

const outsideReducedMotion = database.replace(/@media \(prefers-reduced-motion: reduce\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const reducedMotion = [ ...database.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ]
  .map((match) => match[1]).join(' ');

const body = (css: string, selector: string): string =>
  rules(css).filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(';');

const MENU = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-menu']";
const MENU_CLOSED = `${MENU}:not([data-blok-popover-opened='true'])`;

describe('database menus', () => {
  it('fade and scale in over 200ms ease', () => {
    expect(body(outsideReducedMotion, `${MENU} [data-blok-popover-container]`)).toContain('transition: opacity 200ms ease, transform 200ms ease');
  });

  it('stay in the top layer for the whole 200ms close', () => {
    expect(body(outsideReducedMotion, "[data-blok-popover][popover][data-blok-popover-custom-class~='blok-database-menu']"))
      .toContain('transition: display 200ms allow-discrete, overlay 200ms allow-discrete');
  });

  it('start, and close back to, scale .96', () => {
    expect(body(outsideReducedMotion, `${MENU_CLOSED} [data-blok-popover-container]`)).toContain('transform: scale(0.96)');
  });

  it('do not move under reduced motion', () => {
    expect(body(reducedMotion, `${MENU} [data-blok-popover-container]`)).toContain('transition: none');
    expect(body(reducedMotion, `${MENU_CLOSED} [data-blok-popover-container]`)).toContain('transform: none');
  });
});

describe('grouped list collapse', () => {
  it('turns only the caret, -90deg over 200ms ease-out', () => {
    expect(body(outsideReducedMotion, '[data-blok-database-list-group-toggle] svg')).toContain('transition: transform 200ms ease-out');
    expect(body(outsideReducedMotion, '[data-blok-database-list-group][data-collapsed] [data-blok-database-list-group-toggle] svg'))
      .toContain('transform: rotate(-90deg)');
  });

  it('turns the caret the other way in RTL', () => {
    expect(body(outsideReducedMotion, '[dir="rtl"] [data-blok-database-list-group][data-collapsed] [data-blok-database-list-group-toggle] svg'))
      .toContain('transform: rotate(90deg)');
  });

  it('does not animate the caret under reduced motion', () => {
    expect(body(reducedMotion, '[data-blok-database-list-group-toggle] svg')).toContain('transition: none');
  });
});

describe('view tab switch', () => {
  it('fades the tab background over 100ms ease-in-out', () => {
    expect(body(outsideReducedMotion, '[data-blok-database-tab]')).toContain('transition: background-color 100ms ease-in-out');
  });

  it('starts from the old tab painted active and the new tab blank', () => {
    expect(body(outsideReducedMotion, '[data-blok-database-tab][data-blok-database-tab-was-active]'))
      .toContain('background-color: var(--blok-database-tab-bg-active)');
    expect(body(outsideReducedMotion, '[data-blok-database-tab][data-active][data-blok-database-tab-activating]'))
      .toContain('background-color: var(--blok-database-tab-bg)');
  });

  it('does not fade under reduced motion', () => {
    expect(body(reducedMotion, '[data-blok-database-tab]')).toContain('transition: none');
  });
});

describe('side peek', () => {
  it('takes the width the drawer sets, 756px by default, and slides with translateX over 200ms ease', () => {
    const drawer = body(outsideReducedMotion, '[data-blok-database-drawer]');

    expect(drawer).toContain('width: min(var(--_blok-peek-width, 756px), 100vw)');
    expect(drawer).toContain('transform: translateX(100%)');
    expect(drawer).toContain('transition: transform 200ms ease');
    expect(drawer).not.toMatch(/transition: width/);
    expect(body(outsideReducedMotion, '[data-blok-database-drawer][data-open]')).toContain('transform: none');
  });

  it('slides in from the left in RTL', () => {
    expect(body(outsideReducedMotion, '[dir="rtl"] [data-blok-database-drawer]')).toContain('transform: translateX(-100%)');
  });

  it('keeps the page beside it and adds scroll room past its end', () => {
    // The host is the editor wrapper; its `all: initial !important` reset does not reach ::after.
    const room = body(outsideReducedMotion, '[data-blok-interface=blok][data-blok-database-peek="scroll"]::after');

    expect(room).toContain("content: ''");
    expect(room).toContain('position: absolute');
    expect(room).toContain('inset-inline-start: 100%');
    expect(room).toContain('inline-size: var(--_blok-peek-inset, 0px)');
    expect(room).toContain('pointer-events: none');
    expect(body(outsideReducedMotion, '[data-blok-interface=blok][data-blok-database-peek="scroll"]')).not.toContain('padding-inline-end');
  });

  it('narrows a page that cannot scroll toward the peek over the same 200ms', () => {
    // The host is the editor wrapper; its `all: initial !important` reset beats anything weaker.
    const host = body(outsideReducedMotion, '[data-blok-interface=blok][data-blok-database-peek="narrow"]');

    expect(host).toContain('padding-inline-end: var(--_blok-peek-inset, 0px) !important');
    expect(host).toContain('transition: padding-inline-end 200ms ease !important');
  });

  it('lets the page follow a resize drag at once', () => {
    expect(body(outsideReducedMotion, '[data-blok-interface=blok][data-blok-database-peek="narrow"][data-blok-database-peek-resizing]'))
      .toContain('transition: none !important');
  });

  it('neither slides nor narrows gradually under reduced motion', () => {
    expect(body(reducedMotion, '[data-blok-database-drawer]')).toContain('transition: none');
    expect(body(reducedMotion, '[data-blok-interface=blok][data-blok-database-peek="narrow"]')).toContain('transition: none !important');
  });
});

describe('panel list drag', () => {
  const ITEM = '[data-blok-database-panel-list-item]';

  it('keeps the dragged row as it looks: no fade, fill, shadow or transform (r35:507)', () => {
    const dragged = body(database, `${ITEM}[data-dragging]`);

    expect(dragged).not.toMatch(/opacity|background|box-shadow|transform/);
  });

  it('jumps rows with no transition', () => {
    expect(body(database, ITEM)).not.toContain('transition');
    expect(body(database, `${ITEM}[data-dragging]`)).not.toContain('transition');
  });
});
