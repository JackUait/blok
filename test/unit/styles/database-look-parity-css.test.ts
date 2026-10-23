/**
 * Database chrome against Notion's measured values (research/07 and 08).
 * jsdom has no CSS, so these read the authored source; the computed look is
 * pinned in test/playwright/tests/database/database-look-parity.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** Every declaration block whose selector list contains `selector`, joined. */
const ruleBody = (selector: string): string =>
  [ ...database.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
    .join(';');

/** A token's value in the light block, then the two dark blocks. */
const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

const reducedMotion = (): string =>
  [ ...database.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ].map((m) => m[1]).join(' ');

describe('view tabs (research/07:45-50, 222)', () => {
  it('are 6px 12px pills with a 14px/16.8px 500 label and a 20px icon', () => {
    const body = ruleBody('[data-blok-database-tab]');

    expect(body).toContain('padding: var(--blok-space-1-5) var(--blok-space-3)');
    expect(body).toContain('border-radius: var(--blok-radius-pill)');
    expect(body).toContain('line-height: 16.8px');
    expect(body).toContain('font-weight: 500');
    expect(ruleBody('[data-blok-database-tab] svg')).toContain('width: 20px');
  });

  it('take Notion ink and fill in light and dark', () => {
    expect(tokenValues('--blok-database-tab-bg-active')).toEqual(['rgba(33, 27, 23, 0.05)', 'rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)']);
    // Light points at the AA step of Notion's rgb(125, 122, 117).
    expect(tokenValues('--blok-database-tab-text')).toEqual(['var(--blok-database-ink-secondary)', 'rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
    expect(tokenValues('--blok-database-ink-secondary')[0]).toBe('rgb(114, 111, 106)');
    expect(tokenValues('--blok-database-tab-text-active')).toEqual(['rgb(44, 44, 43)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
  });
});

describe('tab "Display as" (research/03 §1.2)', () => {
  it('drops the icon for text only, and hides the name visually, not from screen readers, for icon only', () => {
    expect(ruleBody('[data-blok-database-tab-bar][data-display="text"] [data-blok-database-tab-icon]')).toContain('display: none');
    const iconOnly = ruleBody('[data-blok-database-tab-bar][data-display="icon"] [data-blok-database-tab-name]');

    expect(iconOnly).toContain('clip-path: inset(50%)');
    expect(iconOnly).not.toContain('display: none');
  });
});

describe('toolbar Filter and Sort (research/07:53)', () => {
  it('are 28px icon buttons in Notion icon gray', () => {
    const body = ruleBody('[data-blok-database-view-toolbar] [data-blok-database-toolbar-icon]');

    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
    expect(body).toContain('color: var(--blok-database-table-header-icon)');
  });
});

describe('board card (research/07:132-135, 08:73, 317)', () => {
  it('is at least 40px with an ink title', () => {
    expect(ruleBody('[data-blok-database-card]')).toContain('min-height: 40px');
    expect(ruleBody('[data-blok-database-card-title]')).toContain('color: var(--blok-database-table-cell-text)');
  });

  it('shows a white action pill with the menu shadow that fades in 200ms', () => {
    const body = ruleBody('[data-blok-database-card-actions]');

    expect(body).toContain('background: var(--blok-database-card-actions-bg)');
    expect(body).toContain('box-shadow: var(--blok-database-card-actions-shadow)');
    expect(body).toContain('transition: opacity 200ms ease');
    expect(tokenValues('--blok-database-card-actions-bg')).toEqual(Array(3).fill('var(--blok-database-table-open-bg)'));
    expect(ruleBody('[data-blok-database-card-menu]')).toContain('height: 24px');
  });

  it('keeps the action icons readable on hover: no white-on-dark ink left', () => {
    expect(ruleBody('[data-blok-database-card-menu]:hover')).not.toContain('--blok-text-on-dark');
  });

  it('stops the pill fade under reduced motion', () => {
    expect(reducedMotion()).toMatch(/\[data-blok-database-card-actions\][^{]*\{[^}]*transition: none/);
  });
});

describe('table cells (research/07:69-75, 98; 08:279-280, 380)', () => {
  it('keep 37px rows with a 24px file chip or button: 6px block padding', () => {
    const body = ruleBody('[data-blok-database-table-cell]:is([data-type="files"], [data-type="button"])');

    expect(body).toContain('padding-block: var(--blok-space-1-5)');
  });

  it('pad person cells 8px like select', () => {
    expect(ruleBody('[data-blok-database-table-cell][data-type="person"]')).toContain('padding: var(--blok-space-2)');
  });

  it('space multi-select pills 8px', () => {
    expect(ruleBody('[data-blok-database-table-cell][data-type="multiSelect"] > [data-blok-database-cell]')).toContain('gap: var(--blok-space-2)');
  });

  it('draw URL, email and phone in ink with no underline, beating the holder link utility', () => {
    const body = ruleBody('[data-blok-database-cell] [data-blok-database-cell-link]');

    expect(body).toContain('color: inherit');
    expect(body).toContain('text-decoration: none');
    expect(body).toContain('white-space: pre-wrap');
  });

  // research/22 §3: a 1px rgba(28, 19, 1, 0.11) line drawn as a background, not text-decoration.
  it('underline URL, email and phone with a 1px background line', () => {
    const body = ruleBody('[data-blok-database-cell] [data-blok-database-cell-link]');

    expect(body).toContain('background-image: linear-gradient(var(--blok-database-cell-link-underline), var(--blok-database-cell-link-underline))');
    expect(body).toContain('background-size: 100% 1px');
    expect(body).toContain('background-position: 0 100%');
    expect(body).toContain('background-repeat: no-repeat');
    expect(tokenValues('--blok-database-cell-link-underline')[0]).toBe('rgba(28, 19, 1, 0.11)');
    expect(tokenValues('--blok-database-cell-link-underline')).toHaveLength(3);
  });

  // research/22 §3: on the row page a link value has no hover fill; Comment and Copy show at its end.
  it('show a row page link value\'s buttons on hover, with no fill', () => {
    expect(ruleBody('[data-blok-database-drawer-prop-actions]')).toContain('display: none');
    expect(ruleBody('[data-blok-database-drawer-prop-actions]')).toContain('margin-inline-start: auto');
    expect(ruleBody('[data-blok-database-drawer-prop-value]:hover > [data-blok-database-drawer-prop-actions]')).toContain('display: flex');
    expect(ruleBody('[data-blok-database-drawer-prop-value][data-link][role="button"]:hover')).toContain('background-color: transparent');
  });

  it('keep an unwrapped table cell on one line', () => {
    expect(ruleBody('[data-blok-database-table-cell]:not([data-wrap]) [data-blok-database-cell-link]')).toContain('white-space: inherit');
  });

  it('set the button label 500 on a 16.8px line', () => {
    const body = ruleBody('[data-blok-database-button]');

    expect(body).toContain('font-weight: 500');
    expect(body).toContain('line-height: 16.8px');
  });
});

describe('select editor head (research/08:306)', () => {
  it('tints the chips and search area, pads it 4px and draws an inset bottom line', () => {
    const body = ruleBody('[data-blok-database-select-chips]');

    expect(body).toContain('background-color: var(--blok-database-select-head-bg)');
    expect(body).toContain('padding: var(--blok-space-1)');
    expect(body).toContain('box-shadow: var(--blok-database-table-control-border) 0 -1px 0 0 inset');
    expect(tokenValues('--blok-database-select-head-bg')[0]).toBe('rgba(242, 241, 238, 0.6)');
  });
});

describe('fill handle (D3)', () => {
  it('rings in the gray anchor ink, never the blue focus ring', () => {
    const body = ruleBody('[data-blok-database-table-fill-handle]');

    expect(body).toContain('border: 2px solid var(--blok-database-table-cell-ring)');
    expect(body).not.toContain('--blok-focus-ring');
  });
});

describe('side peek properties (research/08:329)', () => {
  it('use 34px rows and the AA step of Notion secondary ink for labels', () => {
    expect(ruleBody('[data-blok-database-drawer-prop-row]')).toContain('min-height: 34px');
    expect(ruleBody('[data-blok-database-drawer-prop-label]')).toContain('color: var(--blok-database-peek-label)');
    expect(tokenValues('--blok-database-peek-label')[0]).toBe('var(--blok-database-ink-secondary)');
    expect(tokenValues('--blok-database-ink-secondary')[0]).toBe('rgb(114, 111, 106)');
  });
});

describe('row page peek in dark (research/21 §1m)', () => {
  it('paints the side and center peek panel rgb(32, 32, 32) in both dark blocks; light keeps the popover fill', () => {
    expect(ruleBody('[data-blok-database-drawer]')).toContain('background-color: var(--blok-database-peek-bg)');
    expect(tokenValues('--blok-database-peek-bg')).toEqual(['var(--blok-popover-bg)', 'rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
  });

  it('gives the center peek the measured dark ring and drop shadow', () => {
    const dark = 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px';

    expect(tokenValues('--blok-database-peek-shadow').slice(1)).toEqual([dark, dark]);
  });

  it('darkens the center peek backdrop to 0.8 in dark (light 0.6, research/08)', () => {
    expect(ruleBody('[data-blok-database-peek-backdrop]')).toContain('background-color: var(--blok-database-peek-backdrop)');
    expect(tokenValues('--blok-database-peek-backdrop')).toEqual(['rgba(15, 15, 15, 0.6)', 'rgba(15, 15, 15, 0.8)', 'rgba(15, 15, 15, 0.8)']);
  });

  it('inks the title in the database ink: rgb(44, 44, 43) light (research/26 §1e), rgb(240, 239, 237) dark', () => {
    expect(ruleBody('[data-blok-database-drawer-title]')).toContain('color: var(--blok-database-peek-title)');
    expect(tokenValues('--blok-database-peek-title')).toEqual(['var(--blok-database-ink)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
  });

  it('shows no fill on a hovered value in either theme (research/26 §5f)', () => {
    expect(ruleBody('[data-blok-database-drawer-prop-value][role="button"]:hover')).toContain('background-color: var(--blok-database-peek-value-hover-bg)');
    expect(tokenValues('--blok-database-peek-value-hover-bg')).toEqual(['transparent', 'transparent', 'transparent']);
  });

  it('gives the side peek the measured shadow, ring included, and no border (research/08:329)', () => {
    const body = ruleBody('[data-blok-database-drawer]');

    expect(body).toContain('box-shadow: var(--blok-database-peek-shadow)');
    expect(body).not.toContain('border-inline-start');
    expect(tokenValues('--blok-database-peek-shadow')[0]).toBe('rgba(25, 25, 25, 0.027) 0 8px 12px, rgba(25, 25, 25, 0.027) 0 2px 6px, rgba(42, 28, 0, 0.07) 0 0 0 1px');
  });

  it('hovers the whole 160x34 label cell, radius 6px, not the label text (pins excluded)', () => {
    const head = '[data-blok-database-drawer-prop-row]:not([data-blok-database-drawer-pin]) > [data-blok-database-drawer-prop-head]';
    const cell = ruleBody(head);

    expect(cell).toContain('min-inline-size: 160px');
    expect(cell).toContain('min-height: 34px');
    expect(cell).toContain('border-radius: var(--blok-radius-control)');
    expect(ruleBody(`${head}:has(> [data-blok-database-drawer-prop-label][role="button"]:hover)`)).toContain('background-color: var(--blok-database-peek-hover-bg)');
    expect(ruleBody('[data-blok-database-drawer-prop-label][role="button"]:hover')).toBe('');
    // The label's hit area stretches over the cell, icon included, so the box and the click target match.
    expect(ruleBody(`${head} > [data-blok-database-drawer-prop-label][role="button"]::before`)).toContain('inset: 0');
  });

  // research/22 §3: the row page value row is 538x34, level with the 160x34 label cell.
  it('makes a property value 34px tall like its label cell, and leaves pins at 30px', () => {
    const value = ruleBody('[data-blok-database-drawer-prop-row]:not([data-blok-database-drawer-pin]) > [data-blok-database-drawer-prop-value]');

    expect(value).toContain('min-height: 34px');
    expect(ruleBody('[data-blok-database-drawer-prop-value]')).toContain('min-height: 30px');
  });

  it('inks labels and the "Comments" heading rgb(173, 169, 163) in dark', () => {
    expect(tokenValues('--blok-database-peek-label').slice(1)).toEqual(['rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
    expect(ruleBody('[data-blok-database-comments-label]')).toContain('color: var(--blok-database-peek-label)');
  });
});

describe('dark option pills (research/08:294-296)', () => {
  it.each([
    ['purple', 'rgba(208, 147, 255, 0.427)', 'rgb(243, 235, 249)'],
    ['pink', 'rgba(255, 133, 192, 0.427)', 'rgb(250, 233, 241)'],
    ['red', 'rgba(255, 116, 105, 0.525)', 'rgb(252, 233, 231)'],
  ])('%s uses the measured values in both dark blocks', (color, bg, text) => {
    expect(tokenValues(`--blok-database-option-${color}-bg`).slice(1)).toEqual([bg, bg]);
    expect(tokenValues(`--blok-database-option-${color}-text`).slice(1)).toEqual([text, text]);
  });
});

describe('view overflow list (research/13:81, notion-measure5/51-one-more.json)', () => {
  const neutral = (value: string): boolean => {
    const channels = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);

    if (channels === null) return false;
    const [r, g, b] = channels.slice(1).map(Number);

    return Math.max(r, g, b) - Math.min(r, g, b) <= 10;
  };

  it('fills the keyboard highlight gray (research/21 §2) with the same primary ink as every other row', () => {
    const active = ruleBody('[data-blok-database-tab-overflow-item][data-highlighted]');

    expect(ruleBody('[data-blok-database-tab-overflow-new][data-highlighted]')).toBe(active);
    expect(ruleBody('[data-blok-database-tab-overflow-item][data-active]')).toBe('');
    const fill = active.match(/background-color: var\((--[\w-]+)\)/)?.[1];

    expect(fill).toBeDefined();
    expect(tokenValues(fill ?? '').length).toBeGreaterThan(0);
    expect(tokenValues(fill ?? '').every(neutral)).toBe(true);
    expect(active).not.toMatch(/(^|;)\s*color:/);
    expect(ruleBody('[data-blok-database-tab-overflow-item]')).toContain('color: var(--blok-database-ink)');
  });

  it('is 290px wide and shows every row\'s handle and "•••" without hover', () => {
    expect(ruleBody('[data-blok-database-tab-overflow-dropdown]')).toContain('width: 290px');
    const buttons = ruleBody('[data-blok-database-tab-overflow-handle]');

    expect(buttons).not.toBe('');
    expect(buttons).not.toContain('opacity: 0');
  });
});

describe('row page tab bar "N more…" (research/13 §3a)', () => {
  // A shrunk tab would wrap its name and measure narrower than it reads.
  it('keeps every tab on one line at its own width, so the fit measures what shows', () => {
    const body = ruleBody('[data-blok-database-drawer-tabs] > [role="tablist"] > [role="tab"]');

    expect(body).toContain('flex: none');
    expect(body).toContain('white-space: nowrap');
  });

  it('hides a tab that moved into the list', () => {
    expect(ruleBody('[data-blok-database-drawer-tabs] [role="tab"][hidden]')).toContain('display: none');
  });

  it('draws its "N more…" as a bare control that never shrinks', () => {
    const body = ruleBody('[data-blok-database-drawer-tabs] > [data-blok-database-tab-more]');

    expect(body).toContain('flex: none');
    expect(body).toContain('border: none');
    expect(body).toContain('background: none');
  });
});

describe('list rows and form in dark (research/21 §1g, §1k)', () => {
  it('hover a list row with the measured dark fill', () => {
    expect(ruleBody('[data-blok-database-list-row]:hover')).toContain('background-color: var(--blok-database-add-hover-bg)');
    expect(tokenValues('--blok-database-add-hover-bg')).toEqual(['rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)']);
  });

  it('fill the "Only members…" notice with the column tint, measured the same in both themes', () => {
    expect(ruleBody('[data-blok-database-form-access]')).toContain('background-color: var(--blok-database-column-bg)');
  });
});

describe('map pins (research/23 §5b)', () => {
  it('paint a green rule\'s pin rgb(70, 161, 113) in both themes, and keep the rest Notion blue', () => {
    expect(ruleBody('[data-blok-database-map-pin][data-color="green"]')).toContain('--_blok-database-map-pin: var(--blok-database-status-dot-green)');
    expect(tokenValues('--blok-database-status-dot-green')).toStrictEqual(['rgb(70, 161, 113)', 'rgb(70, 161, 113)', 'rgb(70, 161, 113)']);
    expect(ruleBody('[data-blok-database-map-pin]')).toContain('--_blok-database-map-pin: var(--blok-database-map-pin-fill)');
    // research/35 B21 and 37 §4.2: #2383E2 in dark too, not the lighter dark accent.
    expect(tokenValues('--blok-database-map-pin-fill')).toStrictEqual(['rgb(35, 131, 226)']);
  });
});

// feel/findings-rowpage R09: on row hover the type glyph turns into a 16px ⋮⋮ with a grab cursor.
describe('row page property drag handle', () => {
  it('is hidden at rest and replaces the glyph while the row is hovered', () => {
    const shown = '[data-blok-database-drawer-prop-row]:hover > [data-blok-database-drawer-prop-head] > [data-blok-database-drawer-prop-handle]';

    expect(ruleBody('[data-blok-database-drawer-prop-handle]')).toContain('display: none');
    expect(ruleBody('[data-blok-database-drawer-prop-handle]')).toContain('cursor: grab');
    expect(ruleBody('[data-blok-database-drawer-prop-handle] svg')).toContain('inline-size: 16px');
    expect(ruleBody(shown)).toContain('display: inline-flex');
    expect(ruleBody(`${shown} + [data-blok-database-drawer-prop-icon]`)).toContain('display: none');
  });
});

// feel/findings-rowpage R13: "Add a property" is a 34px text button with a 16px plus, 14px/400 warm gray, no dashed border.
describe('row page Add a property', () => {
  it('is an auto-width 34px button, padding 0 8px 0 6px, with no border', () => {
    const body = ruleBody('[data-blok-database-drawer-add-prop]');

    expect(body).toContain('display: inline-flex');
    expect(body).toContain('height: 34px');
    expect(body).toContain('padding: 0 var(--blok-space-2) 0 var(--blok-space-1-5)');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('font-weight: 400');
    // Notion's rgb(161,158,153) fails AA: the "Empty" value's AA step.
    expect(body).toContain('color: var(--blok-database-ink-tertiary)');
    expect(body).toContain('border: none');
    expect(body).not.toContain('width: 100%');
    // The property list is a flex column: without this it stretches to the full width.
    expect(body).toContain('align-self: flex-start');
    expect(ruleBody('[data-blok-database-drawer-add-prop]:hover')).not.toContain('border-color');
    expect(ruleBody('[data-blok-database-drawer-add-prop] svg')).toContain('inline-size: 16px');
  });
});

// feel/findings-rowpage R10: Add icon · Add cover · Customize layout are 28px, padding 0 8px, radius 6, 14px glyph, warm gray,
// and show while the page head or title is hovered, not the whole page.
describe('row page header hover row', () => {
  const buttons = ['[data-blok-database-drawer-add-icon]', '[data-blok-database-drawer-add-cover]', '[data-blok-database-drawer-customize]'];

  it.each(buttons)('%s is 28px, padding 0 8px, radius 6, warm gray', (selector) => {
    const body = ruleBody(selector);

    expect(body).toContain('height: 28px');
    expect(body).toContain('padding: 0 var(--blok-space-2)');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('color: var(--blok-database-ink-tertiary)');
    expect(ruleBody(`${selector} svg`)).toContain('inline-size: 14px');
  });

  it('shows on hover of the page head or the title, not the whole content', () => {
    expect(database.includes('[data-blok-database-drawer-content]:hover [data-blok-database-drawer-add-icon]')).toBe(false);
    expect(database.includes('[data-blok-database-drawer-content]:hover [data-blok-database-drawer-customize]')).toBe(false);
    const shown = '[data-blok-database-drawer-page-head]:is(:hover, :has(+ [data-blok-database-drawer-title]:hover)) [data-blok-database-drawer-customize],';

    expect(database.includes(shown)).toBe(true);
  });
});

// feel/findings-rowpage R29, R32: a row page file chip is at most 200 wide; its name ends in "…" and is not underlined.
describe('row page file chip', () => {
  it('caps the chip at 200px and ellipsizes the name at its end', () => {
    const chip = '[data-blok-database-drawer-prop-value] [data-blok-database-file-chip]';
    const name = ruleBody(`${chip} > [data-blok-database-cell-link]`);

    expect(ruleBody(chip)).toContain('max-width: 200px');
    expect(name).toContain('min-width: 0');
    expect(name).toContain('text-overflow: ellipsis');
    expect(name).toContain('text-decoration: none');
  });
});

// feel/findings-rowpage R15, R26: the empty page prompt box is padding 8px 0 24px 8px; the body placeholder is warm gray.
describe('row page body start', () => {
  it('pads the empty page prompt as Notion', () => {
    expect(ruleBody('[data-blok-database-row-empty]')).toContain('padding: var(--blok-space-2) 0 var(--blok-space-6) var(--blok-space-2)');
  });

  it('inks the body placeholder with the warm AA gray', () => {
    // A host's --blok-placeholder-color still wins (host-customization-tokens law).
    expect(ruleBody('[data-blok-database-drawer-editor] [contenteditable][data-blok-placeholder-active]:empty::before')).toContain('color: var(--blok-placeholder-color, var(--blok-database-ink-tertiary))');
  });
});

// feel/findings-rowpage R16: the value actions sit in a bordered pill: page bg, ring and shadow, radius 6.
describe('row page value actions pill', () => {
  it('wraps Comment and Copy in a ringed pill', () => {
    const pill = ruleBody('[data-blok-database-drawer-prop-actions]');

    expect(pill).toContain('background-color: var(--blok-database-table-open-bg)');
    expect(pill).toContain('box-shadow: var(--blok-database-table-open-shadow)');
    expect(pill).toContain('border-radius: var(--blok-radius-control)');
  });
});

// feel/findings-rowpage R25: the empty title's placeholder takes the database title's warm placeholder ink (T09's call).
describe('row page title placeholder', () => {
  it('uses the title placeholder token', () => {
    expect(ruleBody('[data-blok-database-drawer-title]::placeholder')).toContain('color: var(--blok-database-title-placeholder)');
  });
});
