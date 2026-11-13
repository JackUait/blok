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

/* Filter, Sort and every other panel or editor that sits in a CellPopover (notion-motion.md "Popovers"). */
const EDITOR = "[data-blok-popover][data-blok-popover-custom-class~='blok-database-cell-editor']";
const EDITOR_CLOSED = `${EDITOR}:not([data-blok-popover-opened='true'])`;

/** The rule that wins for `selector`: the last one in the file that names it. */
const lastBody = (css: string, selector: string): string =>
  rules(css).filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).pop() ?? '';

describe('database panels (Filter, Sort, pickers)', () => {
  it('open and close like the database menus: 200ms ease, from and back to scale .96', () => {
    expect(body(outsideReducedMotion, `${EDITOR} [data-blok-popover-container]`)).toContain('transition: opacity 200ms ease, transform 200ms ease');
    expect(body(outsideReducedMotion, `${EDITOR_CLOSED} [data-blok-popover-container]`)).toContain('transform: scale(0.96)');
    expect(body(outsideReducedMotion, "[data-blok-popover][popover][data-blok-popover-custom-class~='blok-database-cell-editor']"))
      .toContain('transition: display 200ms allow-discrete, overlay 200ms allow-discrete');
  });

  it('do not move under reduced motion', () => {
    expect(body(reducedMotion, `${EDITOR} [data-blok-popover-container]`)).toContain('transition: none');
    expect(body(reducedMotion, `${EDITOR_CLOSED} [data-blok-popover-container]`)).toContain('transform: none');
  });

  it.each([
    ['view settings (notion-motion.md "View settings": no entrance)', 'blok-database-docked-panel'],
    ['a table cell editor (notion-motion.md "Cell editors")', 'blok-database-table-cell-editor'],
    ['a row page value editor', 'blok-database-value-editor'],
  ])('%s still opens at its final size and opacity', (_, cls) => {
    const at = `[data-blok-popover][data-blok-popover-custom-class~='${cls}']`;
    const ownRule = lastBody(outsideReducedMotion, `${at} > [data-blok-popover-container]`);
    const closedRule = lastBody(outsideReducedMotion, `${at}:not([data-blok-popover-opened='true']) > [data-blok-popover-container]`);

    expect(ownRule).toContain('transition: none');
    expect(closedRule).toContain('transform: none');
    // The opt-out must come after the panel motion it overrides (same specificity).
    const motionAt = outsideReducedMotion.indexOf(`${EDITOR} [data-blok-popover-container]`);
    const optOutAt = outsideReducedMotion.lastIndexOf(`${at} > [data-blok-popover-container]`);

    expect(motionAt).toBeGreaterThan(-1);
    expect(optOutAt).toBeGreaterThan(motionAt);
  });
});

describe('database menu rows', () => {
  it('fade their hover fill in over 20ms ease-in (notion-motion.md "Popovers")', () => {
    expect(body(outsideReducedMotion, `${MENU} [data-blok-popover-item]`)).toContain('transition: background-color 20ms ease-in');
  });

  it('change their fill at once under reduced motion', () => {
    expect(body(reducedMotion, `${MENU} [data-blok-popover-item]`)).toContain('transition: none');
  });
});

describe('table column header hover', () => {
  const HEADER = '[data-blok-database-table-column-header]';

  // research/08:263, 21:71, 33:658: Notion's header takes a 0.051 fill on hover; notion-motion.md
  // "Popovers": it fades in over 20ms ease-in. A gradient cannot transition, so its colour is a typed property.
  it('registers the tint as a colour, so it can transition', () => {
    expect(database).toMatch(/@property --blok-database-header-tint \{ syntax: '<color>'; inherits: false; initial-value: transparent; \}/);
  });

  it('paints the tint over its opaque fill and fades it over 20ms ease-in', () => {
    const rest = body(outsideReducedMotion, HEADER);

    expect(rest).toContain('background-image: linear-gradient(var(--blok-database-header-tint), var(--blok-database-header-tint))');
    expect(rest).toMatch(/transition: [^;]*--blok-database-header-tint 20ms ease-in/);
  });

  it('takes the hover fill on hover and the pressed fill when pressed', () => {
    expect(body(outsideReducedMotion, `${HEADER}:hover`)).toContain('--blok-database-header-tint: var(--blok-database-table-header-hover-bg)');
    expect(body(outsideReducedMotion, `${HEADER}:active`)).toContain('--blok-database-header-tint: var(--blok-database-pressed-bg)');
  });

  it('does not fade under reduced motion', () => {
    expect(body(reducedMotion, HEADER)).toContain('transition: none');
  });
});

describe('toolbar search', () => {
  const INPUT = '[data-blok-database-search-input]';

  // notion-motion.md "Search": the field grows 0→150 and fades in, both 200ms ease.
  it('fades in while it grows, both over 200ms ease', () => {
    expect(body(outsideReducedMotion, INPUT)).toMatch(/transition: inline-size 0\.2s ease, opacity 0\.2s ease/);
    expect(database).toMatch(/@starting-style \{ \[data-blok-database-search-input\] \{ inline-size: 0; opacity: 0; \} \}/);
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

// notion-motion.md Round 14: the tabs a dragged tab passes slide with translateX over 200ms ease; the dragged one follows the pointer.
describe('view tab drag', () => {
  it('slides the other tabs over 200ms ease and keeps the dragged one on the pointer', () => {
    expect(body(outsideReducedMotion, '[data-blok-database-tab-bar][data-dragging] [data-blok-database-tab]')).toContain('transform 200ms ease');
    // As specific as the rule above, or the dragged tab lags 200ms behind the pointer.
    const dragged = body(outsideReducedMotion, '[data-blok-database-tab-bar][data-dragging] [data-blok-database-tab][data-blok-database-tab-drag-source]');

    expect(dragged).toContain('transition: background-color 100ms ease-in-out');
    expect(dragged).not.toContain('transform');
    expect(body(outsideReducedMotion, '[data-blok-database-tab][data-blok-database-tab-drag-source]')).toBe('');
  });

  it('does not slide under reduced motion', () => {
    expect(body(reducedMotion, '[data-blok-database-tab-bar][data-dragging] [data-blok-database-tab]')).toContain('transition: none');
  });
});

describe('side peek', () => {
  it('takes the width the drawer sets, 756px by default, and slides in from a window width away over 200ms ease', () => {
    const drawer = body(outsideReducedMotion, '[data-blok-database-drawer]');

    // Round 14: 600 wide in a 900px window, two thirds of it.
    expect(drawer).toContain('width: min(var(--_blok-peek-width, 756px), calc(100vw * 2 / 3))');
    // Notion starts at translateX(1512px) in a 1512px window (notion-motion.md "Side peek").
    expect(drawer).toContain('transform: translateX(100vw)');
    expect(drawer).toContain('transition: transform 200ms ease');
    expect(drawer).not.toMatch(/transition: width/);
    expect(body(outsideReducedMotion, '[data-blok-database-drawer][data-open]')).toContain('transform: none');
  });

  it('slides in from the left in RTL', () => {
    expect(body(outsideReducedMotion, '[dir="rtl"] [data-blok-database-drawer]')).toContain('transform: translateX(-100vw)');
  });

  it('narrows the page beside it over the same 200ms', () => {
    // The host is the editor wrapper; its `all: initial !important` reset beats anything weaker.
    const host = body(outsideReducedMotion, '[data-blok-interface=blok][data-blok-database-peek]');

    expect(host).toContain('padding-inline-end: var(--_blok-peek-inset, 0px) !important');
    expect(host).toContain('transition: padding-inline-end 200ms ease !important');
    expect(host).not.toContain('inset-inline-start');
  });

  it('keeps the database toolbar of the narrowed page clear of the peek, but not one inside the peek', () => {
    const bar = body(outsideReducedMotion, '[data-blok-database-peek] [data-blok-database-view-bar]:not([data-blok-database-drawer] *)');

    expect(bar).toContain('margin-inline-end: var(--_blok-peek-gap, 0px)');
    expect(bar).toContain('transition: margin-inline-end 200ms ease');
  });

  // peek-top.png: with one view the toolbar sits in the title row, and New ⌄ still ends 24px short of the peek.
  it('keeps a one-view title row toolbar clear of the peek too, and still under reduced motion', () => {
    const row = '[data-blok-database-peek] [data-blok-database-title-row][data-single-view]:not([data-blok-database-drawer] *)';

    expect(body(outsideReducedMotion, row)).toContain('margin-inline-end: var(--_blok-peek-gap, 0px)');
    expect(body(outsideReducedMotion, row)).toContain('transition: margin-inline-end 200ms ease');
    expect(body(reducedMotion, row)).toContain('transition: none');
  });

  it('lets the page follow a resize drag at once', () => {
    expect(body(outsideReducedMotion, '[data-blok-interface=blok][data-blok-database-peek][data-blok-database-peek-resizing]'))
      .toContain('transition: none !important');
  });

  it('has no pan scrollbar', () => {
    expect(database).not.toContain('data-blok-database-peek-scrollbar');
    expect(database).not.toContain('--_blok-peek-offset');
  });

  it('fades the open row\'s ring in and out over 200ms ease', () => {
    const ring = body(outsideReducedMotion, '[data-blok-database-table-row]::before');
    const peeked = body(outsideReducedMotion, '[data-blok-database-table-row]:has(> [data-blok-database-table-cell] > [data-blok-database-table-open][data-peeked])::before');

    expect(ring).toContain('opacity: 0');
    expect(ring).toContain('transition: opacity 200ms ease');
    expect(peeked).toContain('opacity: 1');
    expect(body(reducedMotion, '[data-blok-database-table-row]::before')).toContain('transition: none');
  });

  it('darkens the OPEN button while it is pressed, then drops back to the hover fill (notion-motion.md "Side peek")', () => {
    const pressed = body(outsideReducedMotion, '[data-blok-database-table-open]:active');

    expect(pressed).toContain('linear-gradient(var(--blok-database-pressed-bg), var(--blok-database-pressed-bg))');
  });

  // notion-motion.md Round 6: Notion's "~70ms" lag was a busy main thread, not a delay.
  it('starts the new row\'s ring on the same frame the old one starts to fade', () => {
    expect(database).not.toContain('data-peeked="step"');
    expect(database).not.toMatch(/\[data-blok-database-table-row\][^{}]*::before \{[^}]*transition-delay/);
  });

  it('neither slides nor narrows gradually under reduced motion', () => {
    expect(body(reducedMotion, '[data-blok-database-drawer]')).toContain('transition: none');
    expect(body(reducedMotion, '[data-blok-interface=blok][data-blok-database-peek]')).toContain('transition: none !important');
    expect(body(reducedMotion, '[data-blok-database-peek] [data-blok-database-view-bar]:not([data-blok-database-drawer] *)')).toContain('transition: none');
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

// notion-motion.md Search and Round 4 re-checks: the field grows 0→150 and fades in over 200ms ease, and closes the same way back.
describe('database toolbar search', () => {
  const INPUT = '[data-blok-database-search-input]';

  it('grows and fades over 200ms ease', () => {
    expect(body(outsideReducedMotion, INPUT)).toContain('transition: inline-size 0.2s ease, opacity 0.2s ease');
  });

  it('starts at no width and no ink', () => {
    const start = [ ...database.matchAll(/@starting-style \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ].map((match) => match[1]).join(' ');

    expect(body(start, INPUT)).toContain('inline-size: 0');
    expect(body(start, INPUT)).toContain('opacity: 0');
  });

  it('shrinks to no width and no ink while it closes', () => {
    const closing = body(outsideReducedMotion, `${INPUT}[data-closing]`);

    expect(closing).toContain('inline-size: 0');
    expect(closing).toContain('opacity: 0');
  });
});

// notion-motion.md Round 4 re-checks: a minimized toolbar keeps only « and settings; « shows on header hover and fades 200ms ease.
describe('minimized database toolbar', () => {
  const TOOLBAR = '[data-blok-database-view-toolbar]';
  const EXPAND = '[data-blok-database-toolbar-expand]';
  const startStyle = [ ...database.matchAll(/@starting-style \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ].map((match) => match[1]).join(' ');

  it('hides every control but settings, « and a search field still shrinking', () => {
    expect(body(database, `${TOOLBAR}[data-minimized] > :not([data-blok-database-toolbar-settings], ${EXPAND}, [data-blok-database-lock-badge], [data-blok-database-search-input][data-closing])`))
      .toContain('display: none');
  });

  it('shows « only while the pointer is on the header, fading over 200ms ease', () => {
    expect(body(outsideReducedMotion, EXPAND)).toContain('opacity: 0');
    expect(body(outsideReducedMotion, EXPAND)).toContain('transition: opacity 0.2s ease');
    expect(body(database, `:is([data-blok-database-title-row], [data-blok-database-view-bar]):hover ${EXPAND}`)).toContain('opacity: 1');
    expect(body(database, `${EXPAND}:focus-visible`)).toContain('opacity: 1');
  });

  // motion-search.json t1217, motion-minimize.json t1190: Notion's 28px » and « fade in over 200ms ease.
  it('fades » and « in over 200ms ease when they appear, keeping the hover fill', () => {
    const MINIMIZE = '[data-blok-database-toolbar-minimize]';
    const pair = `${TOOLBAR} > :is(${MINIMIZE}, ${EXPAND})`;

    // Must outrank `${TOOLBAR} > button`, which sets only the hover fill.
    expect(body(outsideReducedMotion, pair)).toContain('transition: background-color 0.1s ease-in-out, opacity 0.2s ease');
    expect(body(startStyle, `${TOOLBAR} > ${MINIMIZE}`)).toContain('opacity: 0');
    expect(body(startStyle, `:is([data-blok-database-title-row], [data-blok-database-view-bar]):hover ${EXPAND}`)).toContain('opacity: 0');
    expect(body(reducedMotion, pair)).toContain('transition: none');
  });

  it('draws « as a mirrored »', () => {
    expect(body(database, `${EXPAND} svg`)).toContain('transform: scaleX(-1)');
  });

  it('fades the controls back in over 200ms ease when « expands it', () => {
    expect(body(outsideReducedMotion, `${TOOLBAR}[data-expanding] > *`)).toContain('transition: opacity 0.2s ease');
    expect(body(startStyle, `${TOOLBAR}[data-expanding] > *`)).toContain('opacity: 0');
  });
});

// notion-motion.md Round 9 "Collapsed group header": the toggle's hover fill comes in over 20ms ease-in.
describe('grouped table: the group caret', () => {
  const TOGGLE = '[data-blok-database-table-group-toggle]';

  it('fades its hover fill in over 20ms ease-in', () => {
    expect(body(outsideReducedMotion, TOGGLE)).toContain('transition: background-color 20ms ease-in');
  });

  it('does not fade under reduced motion', () => {
    expect(body(reducedMotion, TOGGLE)).toContain('transition: none');
  });
});

// replica-db-properties/notion-spec.md §1: the label cell has `transition: background 0.02s ease-in`.
describe('side peek properties: the label cell', () => {
  it('fades its hover fill in over 20ms ease-in', () => {
    const HEAD = '[data-blok-database-drawer-prop-row]:not([data-blok-database-drawer-pin]) > [data-blok-database-drawer-prop-head]';

    expect(body(outsideReducedMotion, HEAD)).toContain('transition: background-color 20ms ease-in');
  });
});
