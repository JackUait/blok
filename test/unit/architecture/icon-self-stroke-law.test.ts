/**
 * Architectural enforcement: every Blok icon declares its OWN stroke.
 *
 * The editor wrapper used to carry the Tailwind arbitrary variant
 * `[&_path]:stroke-current`, which compiles to a descendant rule painting
 * `stroke: currentColor` on EVERY `<path>` inside the editor subtree. Author
 * CSS always outranks an SVG presentation attribute, so that broadcast also
 * overrode a HOST-authored glyph's own `stroke="none"` — a solid design-system
 * icon rendered inside a block came out rimmed with a 1px currentColor outline
 * and visibly fattened, and no plain `svg path { stroke: none }` rule could
 * undo it.
 *
 * The broadcast was deleted (src/components/modules/ui.ts). That is only safe
 * while every first-party icon is self-sufficient: each `<path>` either carries
 * `stroke=` itself or inherits one from an ancestor `<svg>`/`<g>`. This law
 * pins that property so a future icon cannot quietly start depending on an
 * ambient stroke that no longer exists — the failure mode would be an icon that
 * renders as an invisible/solid blob only inside block content, and nowhere
 * else (popovers mount to document.body, outside the old rule's reach).
 *
 * Fill-only glyphs — solid shapes drawn purely with `fill` — are the legitimate
 * exception and are listed below with a reason. They were the icons the
 * broadcast actively HARMED.
 */
import { describe, expect, it } from 'vitest';
import * as icons from '../../../src/components/icons';

/**
 * Icons whose `<path>` elements are deliberately fill-only: solid glyphs with
 * no outline. These must NOT gain an ambient stroke — that is the defect the
 * broadcast caused.
 */
const FILL_ONLY_ICONS: Readonly<Record<string, string>> = {
  IconHeaderRow: 'solid header band drawn with fill; the grid lines beside it are stroked separately',
  IconHeaderColumn: 'solid header band drawn with fill; the grid lines beside it are stroked separately',
  IconPlayerPlay: 'solid play triangle — rendered in-block by the video/audio controls',
  IconPlayerBackward: 'solid skip-back triangles',
  IconPlayerForward: 'solid skip-forward triangles',
  IconPlayerVolume: 'solid speaker cone; the sound waves beside it are stroked separately',
  IconPlayerVolumeMute: 'solid speaker cone; the mute cross beside it is stroked separately',
};

/** Every exported icon markup string, keyed by its export name. */
const iconEntries = Object.entries(icons).filter(
  (entry): entry is [string, string] => entry[0].startsWith('Icon') && typeof entry[1] === 'string'
);

/**
 * Parse an icon string and return the `<path>` elements that resolve NO stroke
 * from themselves or any ancestor element.
 * @param markup - the icon's SVG source string
 * @returns the `d` attributes of the un-stroked paths (empty when self-sufficient)
 */
const unstrokedPaths = (markup: string): string[] => {
  const host = document.createElement('div');

  host.innerHTML = markup;

  return Array.from(host.querySelectorAll('path'))
    .filter((path) => {
      let node: Element | null = path;

      while (node !== null && node !== host) {
        if (node.hasAttribute('stroke')) {
          return false;
        }

        node = node.parentElement;
      }

      return true;
    })
    .map((path) => path.getAttribute('d') ?? '(no d)');
};

describe('icon self-stroke law', () => {
  it('finds the icon surface to scan (guards against a broken import)', () => {
    expect(iconEntries.length).toBeGreaterThan(100);
  });

  it.each(iconEntries)('%s declares its own stroke or is an approved fill-only glyph', (name, markup) => {
    const offenders = unstrokedPaths(markup);
    const isExempt = name in FILL_ONLY_ICONS;

    if (isExempt) {
      return;
    }

    expect(
      offenders,
      `${name} has <path> elements with no stroke of their own and no stroked ancestor. ` +
        'Blok no longer broadcasts `stroke: currentColor` over the editor subtree, so this icon ' +
        'would render un-stroked. Add `stroke="currentColor"` to the path (or to its <svg> root), ' +
        'or list it in FILL_ONLY_ICONS with a reason if it is a deliberately solid glyph.'
    ).toEqual([]);
  });

  it('carries no stale exemptions — every listed icon exists and is genuinely fill-only', () => {
    const iconNames = new Set(iconEntries.map(([name]) => name));

    for (const [name, reason] of Object.entries(FILL_ONLY_ICONS)) {
      expect(iconNames.has(name), `FILL_ONLY_ICONS lists "${name}", which no longer exists`).toBe(true);
      expect(reason.length, `FILL_ONLY_ICONS["${name}"] needs a reason`).toBeGreaterThan(0);

      const markup = iconEntries.find(([iconName]) => iconName === name)?.[1] ?? '';

      expect(
        unstrokedPaths(markup).length,
        `FILL_ONLY_ICONS lists "${name}", but every one of its paths now carries a stroke — drop the exemption`
      ).toBeGreaterThan(0);
    }
  });
});
