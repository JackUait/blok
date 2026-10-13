/**
 * The row page layout (Notion help/layouts). Notion's layout builder was not
 * measured (research/07 and 08 have no values), so these rules use Blok tokens.
 * jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const database = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = database.match(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

const layoutRules = (): string =>
  [...database.matchAll(/([^{}]*\[data-blok-database-(?:drawer-(?:pins[a-z-]*|pin|prop-head|prop-icon|modules|panel-modules|module|section[a-z-]*|details[a-z-]*|columns|main|tabs|tab-panel|customize|layout-bar)|layout-[a-z-]+)\][^{}]*)\{([^{}]*)\}/g)]
    .map((m) => `${m[1]}{${m[2]}}`)
    .join('\n');

describe('database row page layout css', () => {
  it('scrolls pinned properties sideways instead of wrapping', () => {
    const body = ruleBody('[data-blok-database-drawer-pins]');

    expect(body).toContain('display: flex');
    expect(body).toContain('overflow-x: auto');
  });

  it('marks the open tab with primary ink and an underline, never blue', () => {
    const body = ruleBody('[data-blok-database-drawer-tabs] [role="tab"][aria-selected="true"]');

    expect(body).toContain('color: var(--blok-text-primary)');
    expect(body).toContain('box-shadow: inset 0 -2px 0 currentColor');
    expect(body).not.toMatch(/blue|#2383e2|rgb\(35, 131, 226\)/i);
  });

  it('shows Customize layout on page hover, like Add icon', () => {
    expect(ruleBody('[data-blok-database-drawer-customize]')).toContain('opacity: 0');
    expect(database).toMatch(/\[data-blok-database-drawer-content\]:hover \[data-blok-database-drawer-customize\][^{]*\{ opacity: 1; \}/);
  });

  it('turns the section caret and the details panel motion off for reduced motion', () => {
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \[data-blok-database-drawer-section-toggle\] svg \{ transition: none; \}/);
  });

  it('sets the details panel beside the page column and wraps it below when narrow', () => {
    const columns = ruleBody('[data-blok-database-drawer-columns]');
    const main = ruleBody('[data-blok-database-drawer-columns] > [data-blok-database-drawer-main]');
    const panel = ruleBody('[data-blok-database-drawer-columns] > [data-blok-database-drawer-details]');

    expect(columns).toContain('display: flex');
    expect(columns).toContain('flex-wrap: wrap');
    expect(columns).toContain('align-items: flex-start');
    expect(columns).not.toMatch(/row-reverse/);
    expect(main).toContain('flex: 999 1 240px');
    expect(main).toContain('min-inline-size: 0');
    expect(panel).toContain('flex: 1 1 240px');
  });

  // research/09 §9: full page, a 385px column at the window's right edge, full height, 1px left border.
  it('docks the details panel to the window edge on a full page', () => {
    const panel = ruleBody('[data-blok-database-drawer][data-peek-mode="full"] [data-blok-database-drawer-details]');

    expect(panel).toContain('position: fixed');
    expect(panel).toContain('inset-block: 0');
    expect(panel).toContain('inset-inline-end: 0');
    expect(panel).toContain('inline-size: 385px');
    expect(panel).toContain('border-inline-start: 1px solid');
    expect(panel).toContain('border-radius: 0');
  });

  // research/09 §9: center peek, a 280px column inside the modal; the page narrows beside it.
  it('docks the details panel inside the center peek modal', () => {
    const panel = ruleBody('[data-blok-database-drawer][data-peek-mode="center"] [data-blok-database-drawer-details]');

    expect(panel).toContain('position: absolute');
    expect(panel).toContain('inset-inline-end: 0');
    expect(panel).toContain('inset-block-end: 0');
    expect(panel).toContain('inline-size: 280px');
    expect(panel).toContain('border-inline-start: 1px solid');
    expect(ruleBody('[data-blok-database-drawer][data-peek-mode="center"][data-details-open] [data-blok-database-drawer-content]'))
      .toContain('padding-inline-end: calc(280px + 60px)');
  });

  it('puts a 16px icon in the label column, which keeps the label width', () => {
    const head = ruleBody('[data-blok-database-drawer-prop-head]');

    expect(head).toContain('display: flex');
    expect(head).toContain('min-width: 100px');
    expect(ruleBody('[data-blok-database-drawer-prop-icon]')).toContain('inline-size: 16px');
    expect(ruleBody('[data-blok-database-drawer-prop-label]')).not.toContain('min-width');
  });

  it('lets the pins scroller shrink in its row, and flips the arrows in RTL', () => {
    expect(ruleBody('[data-blok-database-drawer-pins-row]')).toContain('display: flex');
    expect(ruleBody('[data-blok-database-drawer-pins-row] > [data-blok-database-drawer-pins]')).toContain('min-inline-size: 0');
    expect(ruleBody('[dir="rtl"] [data-blok-database-drawer-pins-back] svg, [dir="rtl"] [data-blok-database-drawer-pins-forward] svg')).toContain('transform: scaleX(-1)');
  });

  // research/09 §4: 32x32, radius 6px, no fill, 20px chevron, 0.1s ease-in fade, shown per side.
  it('draws the pin arrows as Notion measured them', () => {
    const arrow = ruleBody('[data-blok-database-drawer-pins-back], [data-blok-database-drawer-pins-forward]');

    expect(arrow).toContain('position: absolute');
    expect(arrow).toContain('inline-size: 32px');
    expect(arrow).toContain('block-size: 32px');
    expect(arrow).toContain('border-radius: var(--blok-radius-control)');
    expect(arrow).toContain('background: none');
    expect(arrow).toContain('opacity: 0');
    expect(arrow).toContain('visibility: hidden');
    expect(arrow).toContain('transition: opacity 0.1s ease-in, visibility 0.1s ease-in');
    expect(ruleBody('[data-blok-database-drawer-pins-back]')).toContain('inset-inline-start: -4px');
    expect(ruleBody('[data-blok-database-drawer-pins-forward]')).toContain('inset-inline-end: -4px');
    expect(ruleBody('[data-blok-database-drawer-pins-back] svg, [data-blok-database-drawer-pins-forward] svg')).toContain('inline-size: 20px');
    const shown = ruleBody('[data-blok-database-drawer-pins-row][data-scroll-back] > [data-blok-database-drawer-pins-back], [data-blok-database-drawer-pins-row][data-scroll-forward] > [data-blok-database-drawer-pins-forward]');

    expect(shown).toContain('opacity: 1');
    expect(shown).toContain('visibility: visible');
    expect(database).not.toMatch(/\[data-blok-database-drawer-pins-(?:back|forward)\]:hover[^{]*\{[^}]*background/);
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-drawer-pins-back\], \[data-blok-database-drawer-pins-forward\] \{ transition: none; \}/);
  });

  it('fades 100px at each pins edge that still hides content', () => {
    expect(ruleBody('[data-blok-database-drawer-pins-row][data-scroll-back] > [data-blok-database-drawer-pins]')).toContain('--_blok-pins-fade-start: 100px');
    expect(ruleBody('[data-blok-database-drawer-pins-row][data-scroll-forward] > [data-blok-database-drawer-pins]')).toContain('--_blok-pins-fade-end: 100px');
    expect(ruleBody('[data-blok-database-drawer-pins]')).toMatch(/mask-image: linear-gradient\(to right, transparent, #000 var\(--_blok-pins-fade-start, 0px\), #000 calc\(100% - var\(--_blok-pins-fade-end, 0px\)\), transparent\)/);
    expect(ruleBody('[dir="rtl"] [data-blok-database-drawer-pins]')).toContain('to left');
  });

  // research/10 §8: backdrop rgb(249,248,247). The canvas ring is neutral, not Notion's blue (Q6).
  it('paints the backdrop and the canvas ring with builder tokens', () => {
    const root = ruleBody('[data-blok-database-layout-builder]');
    const canvas = ruleBody('[data-blok-database-layout-canvas]');

    expect(root).toContain('position: fixed');
    expect(root).toContain('inset: 0');
    expect(root).toContain('background-color: var(--blok-database-builder-backdrop)');
    // Body-mounted: nothing else gives it the editor's font.
    expect(root).toContain('font-family: var(--blok-font-family, var(--blok-font-sans))');
    expect(database).toMatch(/--blok-database-builder-backdrop: rgb\(249, 248, 247\);/);
    expect(canvas).toContain('background-color: var(--blok-bg-primary)');
    expect(canvas).toContain('box-shadow: 0 0 0 3px var(--blok-database-builder-canvas-ring)');
    expect(canvas).toContain('border-start-start-radius: var(--blok-radius-dialog)');
    expect(canvas).toContain('border-start-end-radius: var(--blok-radius-dialog)');
    const rings = [...database.matchAll(/--blok-database-builder-canvas-ring: ([^;]+);/g)].map((m) => m[1]);

    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(ring).not.toMatch(/rgb\(206, 227, 247\)|accent|blue|#2383e2/i);
  });

  // research/09 §10: 60px bar, 16px side padding; at 756px nothing wraps.
  it('keeps the top bar on one line at 756px', () => {
    const bar = ruleBody('[data-blok-database-layout-topbar]');

    expect(bar).toContain('display: flex');
    expect(bar).toContain('flex-wrap: nowrap');
    expect(bar).toContain('block-size: 60px');
    expect(bar).toContain('padding-inline: var(--blok-space-4)');
    expect(ruleBody('[data-blok-database-layout-actions]')).toContain('flex-shrink: 0');
    expect(ruleBody('[data-blok-database-layout-cancel], [data-blok-database-layout-apply]')).toContain('white-space: nowrap');
  });

  // research/09 §10: Cancel has no fill; Apply is the primary action, so it stays blue.
  it('fills only Apply, and joins its chevron half to it', () => {
    expect(ruleBody('[data-blok-database-layout-cancel]')).toContain('background: none');
    expect(ruleBody('[data-blok-database-layout-apply]')).toContain('background-color: var(--blok-accent)');
    expect(ruleBody('[data-blok-database-layout-apply]')).toContain('border-start-end-radius: 0');
    expect(ruleBody('[data-blok-database-layout-more-save]')).toContain('background-color: var(--blok-accent)');
    expect(ruleBody('[data-blok-database-layout-more-save]')).toContain('border-start-start-radius: 0');
  });

  // Rings follow keyboard modality, never a click.
  it('rings builder controls on keyboard focus only', () => {
    expect(database).toMatch(/\[data-blok-database-layout-cancel\]:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--blok-focus-ring\)/);
  });

  // research/09 §2: "Preview: <page>", 12px/500 grey, 3px 6px padding, no fill at rest, under the title.
  it('draws the Preview switch as a grey text button under the title, with no fill', () => {
    const preview = ruleBody('[data-blok-database-layout-preview]');

    expect(ruleBody('[data-blok-database-layout-heading]')).toContain('flex-direction: column');
    expect(preview).toContain('font-size: 12px');
    expect(preview).toContain('font-weight: 500');
    expect(preview).toContain('color: var(--blok-text-secondary)');
    expect(preview).toContain('background: none');
    expect(preview).toContain('pointer-events: auto');
    expect(database).toMatch(/\[data-blok-database-layout-preview\]:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--blok-focus-ring\)/);
  });

  // research/09 §1: the zero-row heading shows the grey placeholder "New page".
  it('greys the placeholder title and the empty lines of a placeholder page', () => {
    expect(ruleBody('[data-blok-database-layout-canvas-title][data-placeholder]')).toContain('color: var(--blok-text-tertiary)');
    expect(ruleBody('[data-blok-database-layout-canvas-content], [data-blok-database-layout-group-empty]')).toContain('color: var(--blok-text-tertiary)');
    // research/09 §1: the zero-row Preview menu reads "No results." in grey, inset like a menu row.
    expect(ruleBody('[data-blok-database-layout-preview-empty]')).toContain('color: var(--blok-text-secondary)');
    expect(ruleBody('[data-blok-database-layout-preview-empty]')).toContain('padding-inline: var(--blok-space-2)');
  });

  // research/10 §2: 117x80 cards. Notion rings the selected one blue; the blue law makes it neutral.
  it('marks the selected Structure card with primary ink and no blue', () => {
    const card = ruleBody('[data-blok-database-layout-structure-card]');
    const selected = ruleBody('[data-blok-database-layout-structure-card][aria-pressed="true"]');
    const ink = (body: string): string | undefined => body.match(/(?:^|;)\s*color: ([^;]+);/)?.[1];

    expect(card).toContain('inline-size: 117px');
    expect(card).toContain('block-size: 80px');
    expect(ink(card)).toBe('var(--blok-text-primary)');
    expect(selected).not.toMatch(/background/);
    expect(ink(selected) ?? ink(card)).toBe(ink(card));
    expect(selected).toContain('font-weight: 600');
    expect(selected).toContain('var(--blok-database-card-border-active)');
    expect(selected).not.toMatch(/accent|blue|focus-ring|#2383e2|toggle-on/i);
  });

  // research/10 §8: white 8px cards with a hairline ring and a header strip. Notion's are blue; Q6 makes them neutral.
  it('draws module cards with a neutral ring and header strip', () => {
    const card = ruleBody('[data-blok-database-layout-module]');
    const strip = ruleBody('[data-blok-database-layout-module-header]');
    const name = ruleBody('[data-blok-database-layout-module-name]');

    expect(card).toContain('background-color: var(--blok-bg-primary)');
    expect(card).toContain('border-radius: var(--blok-radius-control-lg)');
    expect(card).toContain('box-shadow: inset 0 0 0 1px var(--blok-database-builder-canvas-ring)');
    expect(strip).toContain('background-color: var(--blok-database-builder-canvas-ring)');
    expect(name).toContain('color: var(--blok-text-secondary)');
    expect(name).toContain('font-weight: 500');
    for (const body of [card, strip, name]) expect(body).not.toMatch(/accent|blue|#2383e2|rgb\(35, 131, 226\)|rgb\(182, 212, 243\)/i);
  });

  // A selected module is a selected state: no fill, primary ink, no blue (blue law).
  it('marks the selected module without blue', () => {
    const card = ruleBody('[data-blok-database-layout-module]');
    const selected = ruleBody('[data-blok-database-layout-module][data-selected]');

    expect(selected).toContain('var(--blok-database-card-border-active)');
    expect(selected).not.toMatch(/background/);
    expect(selected).not.toMatch(/(?:^|;)\s*color:/);
    expect(card).not.toMatch(/(?:^|;)\s*color:/);
    expect(selected).not.toMatch(/accent|blue|focus-ring|#2383e2|toggle-on/i);
  });

  // research/09 §3: 28px rows, a 24x24 pin button in primary ink whatever its state.
  it('draws the Heading menu rows 28px high with a 24px pin button in primary ink', () => {
    const row = ruleBody('[data-blok-database-layout-pin-row], [data-blok-database-layout-group-row]');
    const toggle = ruleBody('[data-blok-database-layout-pin-toggle], [data-blok-database-layout-eye]');

    expect(row).toContain('min-block-size: 28px');
    expect(toggle).toContain('inline-size: 24px');
    expect(toggle).toContain('block-size: 24px');
    expect(toggle).toContain('color: var(--blok-text-primary)');
    expect(database).not.toMatch(/\[data-blok-database-layout-pin-toggle\]\[data-pinned\][^{]*\{[^}]*color/);
  });

  // research/09 §3 L56, §5: the Property group menu rows match the Heading menu's; the eye glyph alone shows the state.
  it('draws the Property group menu rows like the Heading menu rows, with a 24px eye button in one ink', () => {
    const row = ruleBody('[data-blok-database-layout-pin-row], [data-blok-database-layout-group-row]');
    const toggle = ruleBody('[data-blok-database-layout-pin-toggle], [data-blok-database-layout-eye]');

    expect(row).toContain('min-block-size: 28px');
    expect(toggle).toContain('inline-size: 24px');
    expect(toggle).toContain('color: var(--blok-text-primary)');
    expect(database).not.toMatch(/\[data-blok-database-layout-eye\]\[data-visibility="(?:always|hideWhenEmpty)"\][^{]*\{[^}]*color/);
    expect(ruleBody('[data-blok-database-panel-header] [data-blok-database-layout-add-section]')).toContain('margin-inline-start: auto');
  });

  // No-blue law: the chosen visibility is a checkmark in primary ink; the row keeps the unchosen rows' fill and ink.
  it('marks the chosen visibility with a primary-ink check and no fill', () => {
    expect(ruleBody('[data-blok-database-panel-check]')).toContain('color: var(--blok-icon-active-text)');
    expect(database).not.toMatch(/\[data-blok-database-panel-row\]\[aria-checked[^{]*\{[^}]*(?:background|color)/);
  });

  // research/09 §10: a 290px column with a 16px/500 title.
  it('draws Page settings as a 290px column with a 16px title', () => {
    expect(ruleBody('[data-blok-database-layout-side]')).toContain('inline-size: 290px');
    expect(ruleBody('[data-blok-database-layout-settings-title]')).toContain('font-size: 16px');
    expect(ruleBody('[data-blok-database-layout-settings-title]')).toContain('font-weight: 500');
  });

  // research/10 §8 L46: a 32px round "+" with the strip's fill. Notion's is blue; Q6 makes it neutral.
  it('draws the Add page module button as a neutral 32px circle', () => {
    const add = ruleBody('[data-blok-database-layout-add-module]');

    expect(add).toContain('inline-size: 32px');
    expect(add).toContain('block-size: 32px');
    expect(add).toContain('border-radius: var(--blok-radius-pill)');
    expect(add).toContain('background-color: var(--blok-database-builder-canvas-ring)');
    expect(add).toContain('color: var(--blok-text-secondary)');
    expect(add).not.toMatch(/accent|blue|#2383e2|rgb\(35, 131, 226\)|rgb\(39, 131, 222\)/i);
  });

  // research/09 anatomy L40: the side panel column with "»" and a pill "+ Add to panel"; collapsed, only the button.
  it('draws the side panel column, its pill and its collapsed state', () => {
    const column = ruleBody('[data-blok-database-layout-panel-column]');
    const pill = ruleBody('[data-blok-database-layout-add-to-panel]');

    expect(column).toContain('display: flex');
    expect(column).toContain('flex-direction: column');
    expect(column).toContain('overflow-y: auto');
    expect(ruleBody('[data-blok-database-layout-panel-column][data-collapsed]')).toContain('inline-size: auto');
    expect(ruleBody('[data-blok-database-layout-panel-body][hidden]')).toContain('display: none');
    expect(pill).toContain('border-radius: var(--blok-radius-pill)');
    expect(pill).not.toMatch(/accent|blue|#2383e2/i);
    expect(database).toMatch(/\[dir="rtl"\] \[data-blok-database-layout-panel-toggle\] svg \{ transform: scaleX\(-1\); \}/);
  });

  // The ⠿ handle takes the pointer only; touch must not scroll instead of dragging.
  it('lets module handles and builder pins drag on touch, and dims the dragged one', () => {
    const handle = ruleBody('[data-blok-database-layout-module-handle]');

    expect(handle).toContain('cursor: grab');
    expect(handle).toContain('touch-action: none');
    expect(ruleBody('[data-blok-database-layout-canvas] [data-blok-database-drawer-pin] [data-blok-database-drawer-prop-head]')).toContain('touch-action: none');
    expect(ruleBody('[data-blok-database-layout-module][data-dragging], [data-blok-database-drawer-pin][data-dragging]')).toContain('opacity: 0.5');
  });

  it('uses logical properties and radius role tokens only', () => {
    const rules = layoutRules();

    expect(rules.length).toBeGreaterThan(0);
    expect(rules).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|\b(?:left|right):/);
    // 0 is allowed, as the radius law allows it.
    expect(rules).not.toMatch(/border-radius: (?!0;)\d/);
    expect(rules).not.toMatch(/:focus(?![-\w])/);
  });
});
