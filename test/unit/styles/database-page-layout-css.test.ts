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
  [...database.matchAll(/([^{}]*\[data-blok-database-(?:drawer-(?:pins[a-z-]*|pin|prop-head|prop-icon|modules|panel-modules|module|section[a-z-]*|details[a-z-]*|columns|main|tabs|tab-panel|customize|layout-bar)|layout-[a-z-]+|drawer-content|row-(?:empty[a-z-]*|pick[a-z-]*|create-template))\][^{}]*)\{([^{}]*)\}/g)]
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

    expect(body).toContain('color: var(--blok-database-ink)');
    expect(body).toContain('box-shadow: inset 0 -2px 0 currentColor');
    expect(body).not.toMatch(/blue|#2383e2|rgb\(35, 131, 226\)/i);
  });

  // feel/findings-rowpage R10: the header row shows on hover of the page head or title, not the whole page.
  it('shows Customize layout on page head hover, like Add icon', () => {
    expect(database).toMatch(/\[data-blok-database-drawer-customize\] \{[^}]*opacity: 0;/);
    expect(database).toMatch(/\[data-blok-database-drawer-page-head\]:is\(:hover, [^{]*\[data-blok-database-drawer-customize\][^{]*\{ opacity: 1; \}/);
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
      .toContain('padding-inline-end: var(--_blok-peek-details-inset)');
    expect(database).toContain('--_blok-peek-details-inset: calc(280px + 60px)');
  });

  // research/22 §10: side peek, a 280px panel at the inline end under the toolbar; the content keeps its width.
  it('docks the details panel inside the side peek', () => {
    const wide = database.match(/@media \(min-width: 844px\) \{([\s\S]*?\}) \}/)?.[1] ?? '';
    const panel = wide.match(/\[data-blok-database-drawer\]\[data-peek-mode="side"\] \[data-blok-database-drawer-details\] \{([^}]*)\}/)?.[1] ?? '';

    expect(panel).toContain('position: absolute');
    expect(panel).toContain('inset-block-start: var(--_blok-peek-toolbar-size, 0px)');
    expect(panel).toContain('inset-inline-end: 0');
    expect(panel).toContain('inline-size: 280px');
    expect(panel).toContain('border-inline-start: 1px solid');
    expect(panel).toContain('background-color: var(--blok-database-peek-bg)');
    expect(wide).toContain('[data-blok-database-drawer][data-peek-mode="side"][data-details-open] [data-blok-database-drawer-content] { padding-inline-end: var(--_blok-peek-details-inset); }');
  });

  // research/22 §10: a 12px col-resize handle on the inner edge; a ring only after keyboard use.
  it('draws the side peek resize handle on its inner edge', () => {
    const handle = ruleBody('[data-blok-database-peek-resize]');

    expect(handle).toContain('position: absolute');
    expect(handle).toContain('inset-inline-start: 0');
    expect(handle).toContain('inline-size: 12px');
    expect(handle).toContain('cursor: col-resize');
    expect(ruleBody('[data-blok-database-peek-resize][hidden]')).toContain('display: none');
    expect(ruleBody('[data-blok-database-peek-resize]:focus-visible')).toContain('outline: none');
    expect(ruleBody('[data-blok-database-peek-resize]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)'))
      .toContain('var(--blok-focus-ring)');
  });

  // research/30 B24: hovering the handle changes nothing on it; only the hint shows.
  it('gives the side peek resize handle no hover look', () => {
    expect(database).not.toMatch(/\[data-blok-database-peek-resize\][^{,]*:hover/);
  });

  it('puts the icon in the label column, which keeps the label width', () => {
    const head = ruleBody('[data-blok-database-drawer-prop-head]');

    expect(head).toContain('display: flex');
    expect(head).toContain('min-width: 100px');
    expect(ruleBody('[data-blok-database-drawer-prop-label]')).not.toContain('min-width');
  });

  // research/09 §8 L83-84: a 14px box at scale 1.2 in the pins, a 16px one at scale 1.2 in the group.
  it('sizes a pin icon 16.8px and a group row icon 19.2px', () => {
    for (const selector of ['[data-blok-database-drawer-prop-icon]', '[data-blok-database-drawer-prop-icon] svg']) {
      expect(ruleBody(selector)).toContain('inline-size: 19.2px');
      expect(ruleBody(selector)).toContain('block-size: 19.2px');
    }
    for (const selector of ['[data-blok-database-drawer-pin] [data-blok-database-drawer-prop-icon]', '[data-blok-database-drawer-pin] [data-blok-database-drawer-prop-icon] svg']) {
      expect(ruleBody(selector)).toContain('inline-size: 16.8px');
      expect(ruleBody(selector)).toContain('block-size: 16.8px');
    }
  });

  // notion-spec §1: the 19x19 glyph keeps its size and overflows the 18px slot instead of shrinking into it.
  it('keeps a group row glyph at full size inside its narrower slot', () => {
    expect(ruleBody('[data-blok-database-drawer-prop-icon] svg')).toContain('flex-shrink: 0');
  });

  // Notion's 756px side peek: label cells start 78px in, values end 76px from the edge. The 8px gutters add to each.
  it('insets the side peek content 70px at the start and 68px at the end', () => {
    const side = ruleBody('[data-blok-database-drawer][data-peek-mode="side"] [data-blok-database-drawer-content]');

    expect(side).toContain('padding-inline-start: 70px');
    expect(side).toContain('padding-inline-end: 68px');
  });

  // notion-spec-2 §5: the side peek title's first glyph sits at peek+84, over the label icons, not the label cell edge.
  it('starts the side peek and full page title text where the label icons start', () => {
    const title = ruleBody(
      '[data-blok-database-drawer][data-peek-mode="side"] [data-blok-database-drawer-title], [data-blok-database-drawer][data-peek-mode="full"] [data-blok-database-drawer-title]'
    );
    const labelHead = ruleBody('[data-blok-database-drawer-prop-row]:not([data-blok-database-drawer-pin]) > [data-blok-database-drawer-prop-head]');

    expect(labelHead).toContain('padding-inline: var(--blok-space-1-5)');
    expect(title).toContain('padding-inline-start: var(--blok-space-1-5)');
  });

  // research/10 §4: an 80x30 cell, padding 0 6px; the empty one reads icon + name, 14px/400 in the empty grey.
  it('draws a label-less pin cell 30px high with a grey placeholder', () => {
    const value = ruleBody('[data-blok-database-drawer-prop-value]');
    const placeholder = ruleBody('[data-blok-database-drawer-prop-placeholder]');

    expect(value).toContain('min-height: 30px');
    expect(value).toContain('padding: 0 var(--blok-space-1-5)');
    // The 34px property row height would stretch the cell past 30px.
    expect(ruleBody('[data-blok-database-drawer-pins] [data-blok-database-drawer-pin][data-labelless]')).toContain('min-height: 0');
    expect(placeholder).toContain('display: inline-flex');
    expect(placeholder).toContain('align-items: center');
    expect(placeholder).toContain('color: var(--blok-database-ink-tertiary)');
    expect(placeholder).toContain('font-size: 14px');
    expect(placeholder).toContain('font-weight: 400');
    // With no label to grab, the builder drags the pin itself, on touch too.
    expect(ruleBody('[data-blok-database-layout-canvas] [data-blok-database-drawer-pin][data-labelless]')).toContain('touch-action: none');
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
    expect(canvas).toContain('background-color: var(--blok-database-builder-canvas-bg)');
    expect(canvas).toContain('box-shadow: 0 0 0 3px var(--blok-database-builder-canvas-ring)');
    expect(canvas).toContain('border-start-start-radius: var(--blok-radius-dialog)');
    expect(canvas).toContain('border-start-end-radius: var(--blok-radius-dialog)');
    const rings = [...database.matchAll(/--blok-database-builder-canvas-ring: ([^;]+);/g)].map((m) => m[1]);

    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(ring).not.toMatch(/rgb\(206, 227, 247\)|accent|blue|#2383e2/i);
  });

  // research/21 §1n: dark backdrop rgb(32,32,32), canvas and modules rgb(25,25,25), Structure tiles rgb(32,32,32) ringed rgb(55,55,55).
  it('uses the measured dark builder surfaces in both dark blocks', () => {
    const values = (name: string): string[] => [...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1].trim());

    expect(values('--blok-database-builder-backdrop')).toEqual(['rgb(249, 248, 247)', 'rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
    expect(values('--blok-database-builder-canvas-bg')).toEqual(['#ffffff', 'rgb(25, 25, 25)', 'rgb(25, 25, 25)']);
    expect(values('--blok-database-builder-tile-bg')).toEqual(['#ffffff', 'rgb(32, 32, 32)', 'rgb(32, 32, 32)']);
    expect(values('--blok-database-builder-tile-ring')).toEqual(['var(--blok-database-drawer-border)', 'rgb(55, 55, 55)', 'rgb(55, 55, 55)']);
    const card = ruleBody('[data-blok-database-layout-structure-card]');

    expect(card).toContain('background-color: var(--blok-database-builder-tile-bg)');
    expect(card).toContain('box-shadow: inset 0 0 0 1px var(--blok-database-builder-tile-ring)');
    expect(ruleBody('[data-blok-database-layout-structure-card][aria-pressed="true"]')).toContain('inset 0 0 0 1px var(--blok-database-builder-tile-ring)');
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
    expect(ruleBody('[data-blok-database-layout-apply]')).toContain('background-color: var(--blok-database-new-bg)');
    expect(ruleBody('[data-blok-database-layout-apply]')).toContain('border-start-end-radius: 0');
    expect(ruleBody('[data-blok-database-layout-more-save]')).toContain('background-color: var(--blok-database-new-bg)');
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
    expect(preview).toContain('color: var(--blok-database-ink-secondary)');
    expect(preview).toContain('background: none');
    expect(preview).toContain('pointer-events: auto');
    expect(database).toMatch(/\[data-blok-database-layout-preview\]:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--blok-focus-ring\)/);
  });

  // research/09 §1: the zero-row heading shows the grey placeholder "New page".
  it('greys the placeholder title and the empty lines of a placeholder page', () => {
    expect(ruleBody('[data-blok-database-layout-canvas-title][data-placeholder]')).toContain('color: var(--blok-database-ink-tertiary)');
    expect(ruleBody('[data-blok-database-layout-canvas-content], [data-blok-database-layout-group-empty]')).toContain('color: var(--blok-database-ink-tertiary)');
    // research/09 §1: the zero-row Preview menu reads "No results." in grey, inset like a menu row.
    expect(ruleBody('[data-blok-database-layout-preview-empty]')).toContain('color: var(--blok-database-ink-secondary)');
    expect(ruleBody('[data-blok-database-layout-preview-empty]')).toContain('padding-inline: var(--blok-space-2)');
  });

  // research/10 §2: 117x80 cards. Notion rings the selected one blue; the blue law makes it neutral.
  // Labels as measured: light 115,114,110 / 29,27,22 (research/10 §2), dark white (research/21 §1n).
  // Dark's measured 90,90,90 fails AA, so the dark label is the tertiary ink's AA step.
  // notion-spec-2 §2: Notion rings the picked Show as tile 2px blue; Blok keeps the 2px ring, neutral.
  it('marks the picked Show as tile with a 2px neutral ring and no fill', () => {
    const tile = ruleBody('[data-blok-database-show-as-tile]');
    const picked = ruleBody('[data-blok-database-show-as-tile][aria-checked="true"]');

    expect(tile).toContain('background-color: transparent');
    expect(tile).toContain('box-shadow: 0 0 0 1px var(--blok-database-card-ring)');
    expect(tile).toContain('color: var(--blok-database-builder-tile-text)');
    expect(picked).toContain('box-shadow: 0 0 0 2px var(--blok-database-card-border-active)');
    expect(picked).toContain('color: var(--blok-database-builder-tile-text-active)');
    expect(picked).not.toMatch(/background|accent|blue|focus-ring|#2383e2|toggle-on/i);
  });

  // notion-spec-2 §2: 72x48 tiles 8px apart, a 48x20 glyph 4px over a 12/12 label, "42" 16/24 500.
  it('sizes the Show as tiles as Notion\'s', () => {
    const tile = ruleBody('[data-blok-database-show-as-tile]');
    const glyph = ruleBody('[data-blok-database-show-as-glyph]');

    expect(ruleBody('[data-blok-database-show-as-tiles]')).toContain('gap: var(--blok-space-2)');
    expect(tile).toContain('inline-size: 72px');
    expect(tile).toContain('block-size: 48px');
    expect(tile).toContain('padding: var(--blok-space-1-5) var(--blok-space-3)');
    expect(tile).toContain('line-height: 1');
    expect(tile).not.toContain('flex: 1 1 0');
    expect(glyph).toContain('inline-size: 48px');
    expect(glyph).toContain('block-size: 20px');
    expect(glyph).toContain('margin-block-end: var(--blok-space-1)');
    expect(glyph).toContain('font-weight: 500');
  });

  // notion-spec-2 §2: a 20px ring, and gray gauges until their tile is picked (Notion turns it blue; Blok keeps the cell ink).
  it('draws the tile gauges gray, at Notion\'s 20px ring', () => {
    const gauges = '[data-blok-database-show-as-glyph] > [data-blok-database-number-bar], [data-blok-database-show-as-glyph] > [data-blok-database-number-ring]';
    const picked = '[data-blok-database-show-as-tile][aria-checked="true"] [data-blok-database-show-as-glyph] > *';

    expect(ruleBody(gauges)).toContain('--blok-database-number-ink: var(--blok-database-status-dot-gray)');
    expect(ruleBody(picked)).toContain('--blok-database-number-ink: var(--blok-database-option-default-text)');
    expect(ruleBody('[data-blok-database-show-as-glyph] > [data-blok-database-number-ring]')).toContain('inline-size: 20px');
    expect(ruleBody('[data-blok-database-show-as-glyph] > [data-blok-database-number-ring]')).toContain('block-size: 20px');
  });

  // notion-spec-2 §2: heading 12px 500 at the panel's +20, 12px under the rule, 16px over the tiles.
  // Notion's heading ink rgb(125,122,117) fails AA at 12px, so it keeps Blok's secondary ink.
  it('sets the Show as heading as Notion\'s', () => {
    const root = ruleBody('[data-blok-database-show-as]');
    const heading = ruleBody('[data-blok-database-show-as-heading]');

    expect(root).toContain('padding: var(--blok-space-2) var(--blok-space-4);');
    expect(heading).toContain('font-weight: 500');
    expect(heading).toContain('line-height: 1.2');
    expect(heading).toContain('padding-block-end: var(--blok-space-4)');
    expect(ruleBody('[data-blok-database-show-as-tiles]')).toContain('padding-inline: var(--blok-space-2)');
  });

  it('marks the selected Structure card with the measured label inks and no blue', () => {
    const card = ruleBody('[data-blok-database-layout-structure-card]');
    const selected = ruleBody('[data-blok-database-layout-structure-card][aria-pressed="true"]');
    const ink = (body: string): string | undefined => body.match(/(?:^|;)\s*color: ([^;]+);/)?.[1];
    const values = (name: string): string[] => [...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1].trim());

    expect(card).toContain('inline-size: 117px');
    expect(card).toContain('block-size: 80px');
    expect(ink(card)).toBe('var(--blok-database-builder-tile-text)');
    expect(ink(selected)).toBe('var(--blok-database-builder-tile-text-active)');
    expect(values('--blok-database-builder-tile-text')).toEqual(['rgb(115, 114, 110)', 'var(--blok-database-ink-tertiary)', 'var(--blok-database-ink-tertiary)']);
    expect(values('--blok-database-builder-tile-text-active')).toEqual(['rgb(29, 27, 22)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
    expect(selected).not.toMatch(/background/);
    expect(selected).toContain('font-weight: 600');
    expect(selected).toContain('var(--blok-database-card-border-active)');
    expect(selected).not.toMatch(/accent|blue|focus-ring|#2383e2|toggle-on/i);
  });

  // research/10 §8: white 8px cards with a hairline ring and a header strip. Notion's are blue; Q6 makes them neutral.
  it('draws module cards with a neutral ring and header strip', () => {
    const card = ruleBody('[data-blok-database-layout-module]');
    const strip = ruleBody('[data-blok-database-layout-module-header]');
    const name = ruleBody('[data-blok-database-layout-module-name]');

    expect(card).toContain('background-color: var(--blok-database-builder-canvas-bg)');
    expect(card).toContain('border-radius: var(--blok-radius-control-lg)');
    expect(card).toContain('box-shadow: inset 0 0 0 1px var(--blok-database-builder-canvas-ring)');
    expect(strip).toContain('background-color: var(--blok-database-builder-canvas-ring)');
    expect(name).toContain('color: var(--blok-database-ink-secondary)');
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
    expect(toggle).toContain('color: var(--blok-database-ink)');
    expect(database).not.toMatch(/\[data-blok-database-layout-pin-toggle\]\[data-pinned\][^{]*\{[^}]*color/);
  });

  // research/09 §3 L56, §5: the Property group menu rows match the Heading menu's; the eye glyph alone shows the state.
  it('draws the Property group menu rows like the Heading menu rows, with a 24px eye button in one ink', () => {
    const row = ruleBody('[data-blok-database-layout-pin-row], [data-blok-database-layout-group-row]');
    const toggle = ruleBody('[data-blok-database-layout-pin-toggle], [data-blok-database-layout-eye]');

    expect(row).toContain('min-block-size: 28px');
    expect(toggle).toContain('inline-size: 24px');
    expect(toggle).toContain('color: var(--blok-database-ink)');
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
    expect(add).toContain('color: var(--blok-database-ink-secondary)');
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

  // research/10 §3: the menu's section rows, the rename field's Done, the canvas "Empty" line.
  it('draws sections in the group menu and on the canvas', () => {
    const row = ruleBody('[data-blok-database-layout-section-row]');

    expect(row).toContain('min-block-size: 24px');
    expect(row).toContain('color: var(--blok-database-ink-secondary)');
    expect(row).toContain('font-weight: 500');
    // Done is the field's primary action, like Apply: a button, not a selected state.
    expect(ruleBody('[data-blok-database-layout-section-done]')).toContain('background-color: var(--blok-database-new-bg)');
    expect(ruleBody('[data-blok-database-layout-section-empty]')).toContain('color: var(--blok-database-ink-tertiary)');
    expect(ruleBody('[data-blok-database-layout-section-empty]')).toContain('padding-inline-start: var(--blok-space-5)');
    expect(ruleBody('[data-blok-database-drawer-section-name]')).toContain('font-size: 13px');
    expect(ruleBody('[data-blok-database-panel-description]')).toContain('color: var(--blok-database-ink-secondary)');
    expect(ruleBody('[data-blok-database-layout-group-handle]')).toContain('cursor: grab');
    // Sections move from their menu only, so their ⠿ is no drag handle.
    expect(ruleBody('[data-blok-database-layout-group-handle], [data-blok-database-layout-section-handle]')).not.toContain('cursor: grab');
    // Rings show after keyboard use only.
    expect(database).toContain('[data-blok-database-layout-section-row]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *)');
    expect(ruleBody('[data-blok-database-layout-group-row][data-dragging]')).toContain('opacity: 0.5');
  });

  // research/10 §6: a tertiary-grey prompt, an underlined "create a template", 32px picker rows with no fill at rest.
  it('draws the empty-page prompt grey, with an underlined create a template', () => {
    const prompt = ruleBody('[data-blok-database-row-empty]');
    const create = ruleBody('[data-blok-database-row-create-template]');

    expect(prompt).toContain('color: var(--blok-database-ink-tertiary)');
    expect(create).toContain('text-decoration: underline');
    expect(create).toContain('cursor: pointer');
  });

  it('draws template picker rows 32px with no fill at rest, and a neutral fill with the same ink when highlighted', () => {
    const pick = ruleBody('[data-blok-database-row-pick]');
    const active = ruleBody('[data-blok-database-row-pick]:hover, [data-blok-database-row-pick][data-active]');
    const ink = (body: string): string | undefined => body.match(/(?:^|;)\s*color: ([^;]+);/)?.[1];

    expect(pick).toContain('block-size: 32px');
    expect(pick).toContain('background: none');
    expect(ink(pick)).toBe('var(--blok-database-ink-secondary)');
    expect(active).toContain('background: var(--blok-item-focus-bg)');
    expect(ink(active) ?? ink(pick)).toBe(ink(pick));
    expect(active).not.toMatch(/accent|blue|focus-ring|#2383e2|toggle-on/i);
  });

  // research/09 §9: Full width widens only the full page (720 -> wider); both peeks keep their width.
  it('widens only the full page when the layout is full width', () => {
    const narrow = ruleBody('[data-blok-database-drawer][data-peek-mode="full"]:not([data-full-width]) [data-blok-database-drawer-content]');

    expect(narrow).toContain('max-inline-size: var(--blok-content-max-width, var(--max-width-content))');
    expect(narrow).toContain('margin-inline: auto');
    expect(database).not.toMatch(/data-peek-mode="(?:side|center)"\][^{]*data-full-width/);
  });

  // research/10 §10: "Properties" 13px/500 grey; "Close panel" a 24px circle with no fill.
  it('draws the panel header and a round Close panel button', () => {
    const title = ruleBody('[data-blok-database-drawer-details-title]');
    const close = ruleBody('[data-blok-database-drawer-details-close]');

    expect(title).toContain('font-size: 13px');
    expect(title).toContain('font-weight: 500');
    expect(title).toContain('color: var(--blok-database-ink-secondary)');
    expect(close).toContain('inline-size: 24px');
    expect(close).toContain('block-size: 24px');
    expect(close).toContain('border-radius: var(--blok-radius-pill)');
    expect(close).toContain('background: none');
    expect(ruleBody('[dir="rtl"] [data-blok-database-drawer-details-close] svg')).toContain('transform: scaleX(var(--_blok-inline-sign, 1))');
  });

  // research/10 §10: Page info gets a fill while the panel is open. The fill is a selected state, so it is gray.
  it('fills Page info with the neutral active token while the panel is open', () => {
    const open = ruleBody('[data-blok-database-peek-page-info][aria-expanded="true"]');

    expect(open).toContain('background-color: var(--blok-icon-active-bg)');
    expect(open).toContain('color: var(--blok-icon-active-text)');
    expect(open).not.toMatch(/blue|#2383e2|rgb\(35, 131, 226\)/i);
  });

  // research/09 §1b: "•••" ends the top bar. research/10 §10: Page info sits before it. research/21 §5: the Favorite star sits right before "•••".
  it('ends the page header with Copy link, Page info, the Favorite star and Actions, whichever show, pushed to the end together', () => {
    const header = ruleBody('[data-blok-database-peek-expand], [data-blok-database-peek-mode], [data-blok-database-peek-prev], [data-blok-database-peek-next], [data-blok-database-peek-copy-link], [data-blok-database-peek-page-info], [data-blok-database-peek-favorite], [data-blok-database-peek-actions]');

    expect(header).toContain('width: 24px');
    expect(header).toContain('background: none');
    expect(ruleBody('[data-blok-database-peek-copy-link], [data-blok-database-peek-page-info], [data-blok-database-peek-favorite], [data-blok-database-peek-actions]')).toContain('margin-inline-start: auto');
    // `~`, not `+`: a hidden star must not leave "•••" with its own auto margin.
    expect(ruleBody('[data-blok-database-peek-copy-link]:not([hidden]) ~ :is([data-blok-database-peek-page-info], [data-blok-database-peek-favorite], [data-blok-database-peek-actions]), [data-blok-database-peek-page-info]:not([hidden]) ~ [data-blok-database-peek-favorite], [data-blok-database-peek-page-info]:not([hidden]) ~ [data-blok-database-peek-actions], [data-blok-database-peek-favorite]:not([hidden]) ~ [data-blok-database-peek-actions]')).toContain('margin-inline-start: 0');
    expect(ruleBody('[data-blok-database-drawer-close][hidden], [data-blok-database-peek-copy-link][hidden], [data-blok-database-peek-expand][hidden], [data-blok-database-peek-page-info][hidden], [data-blok-database-peek-favorite][hidden], [data-blok-database-peek-actions][hidden]')).toContain('display: none');
    // feel/findings-rowpage R04: 20px glyphs, Notion's 22px ellipsis.
    expect(ruleBody('[data-blok-database-peek-expand] svg, [data-blok-database-peek-mode] svg, [data-blok-database-peek-prev] svg, [data-blok-database-peek-next] svg, [data-blok-database-peek-copy-link] svg, [data-blok-database-peek-page-info] svg, [data-blok-database-peek-favorite] svg')).toContain('width: 20px');
    expect(ruleBody('[data-blok-database-peek-actions] svg')).toContain('width: 22px');
  });

  // research/22 §14: favorited is a yellow star, not a selected state, so it gets ink but no button fill.
  it('paints the favorited star Notion\'s yellow, with no button fill', () => {
    const body = ruleBody('[data-blok-database-peek-favorite][aria-pressed="true"]');

    expect(body).toBe(' color: var(--blok-database-favorite-star); ');
    expect(database.match(/--blok-database-favorite-star: ([^;]+);/g)).toEqual(['--blok-database-favorite-star: rgb(246, 192, 80);']);
  });

  // The glyph's panel sits where the details panel opens: the inline end.
  it('mirrors the Page info glyph in RTL', () => {
    expect(ruleBody('[dir="rtl"] [data-blok-database-peek-page-info] svg')).toContain('transform: scaleX(var(--_blok-inline-sign, 1))');
  });

  // research/10 §2: builder tabs are 32px round pills. The selected one has a ring, neutral by the no-blue law.
  it('draws builder tabs as round pills and marks the selected one with a primary ring, never blue', () => {
    const pill = ruleBody('[data-blok-database-layout-canvas] [data-blok-database-drawer-tabs] [role="tab"]');
    const selected = ruleBody('[data-blok-database-layout-canvas] [data-blok-database-drawer-tabs] [role="tab"][aria-selected="true"]');

    expect(pill).toContain('min-height: 32px');
    expect(pill).toContain('border-radius: var(--blok-radius-pill)');
    expect(selected).toContain('color: var(--blok-database-ink)');
    expect(selected).toContain('box-shadow: inset 0 0 0 1.25px var(--blok-database-ink)');
    expect(selected).not.toMatch(/blue|#2383e2|rgb\(35, 131, 226\)|background/i);
  });

  // research/10 §2: a 28px circle; neutral, as the coordinator's Q6 default turned the builder's decorative blue neutral.
  it('draws Add tab as a neutral 28px circle', () => {
    const add = ruleBody('[data-blok-database-layout-add-tab]');

    expect(add).toContain('inline-size: 28px');
    expect(add).toContain('block-size: 28px');
    expect(add).toContain('border-radius: var(--blok-radius-pill)');
    expect(add).not.toMatch(/blue|#2383e2/i);
  });

  // research/10 §2: Add tab shows on hover. Keyboard focus shows it too, and touch has no hover, so it shows there.
  it('reveals Add tab on hover or keyboard focus in the bar, and always without hover', () => {
    expect(ruleBody('[data-blok-database-layout-add-tab]')).toContain('opacity: 0');
    expect(database).toMatch(/\[data-blok-database-drawer-tabs\]:hover \[data-blok-database-layout-add-tab\],\s*\[data-blok-database-drawer-tabs\]:has\(:focus-visible\) \[data-blok-database-layout-add-tab\][^{]*\{ opacity: 1; \}/);
    expect(database).toMatch(/@media \(hover: none\) \{ \[data-blok-database-layout-add-tab\] \{ opacity: 1; \} \}/);
    expect(ruleBody('[data-blok-database-drawer-tabs] > [role="tablist"]')).toContain('display: flex');
  });

  // The row page draws its own strip; the lent tabs block shows only the open tab's panel.
  it('hides the tabs block\'s own strip inside a row page tab panel', () => {
    expect(ruleBody('[data-blok-database-drawer-tab-panel] [data-blok-tabs-strip]')).toContain('display: none');
  });

  // research/10 §2b: a view tab holds the whole linked database with no card and no title of its own.
  it('draws a view tab\'s database with no tabs card frame and no title', () => {
    const frame = ruleBody('[data-blok-database-drawer-tab-panel] [data-blok-tabs]');
    const sheet = ruleBody('[data-blok-database-drawer-tab-panel] [data-blok-tabs-panels]');

    expect(frame).toContain('border: none');
    expect(sheet).toContain('padding: 0');
    expect(sheet).toContain('background: none');
    expect(ruleBody('[data-blok-database-drawer-tab-panel] [data-blok-database-title]')).toContain('display: none');
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
