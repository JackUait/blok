import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const entries = Object.entries(icons).filter(
  (entry): entry is [string, string] => entry[0].startsWith('Icon') && typeof entry[1] === 'string'
);

const overlays = new Set([
  'IconImageBroken', 'IconUploadFailed', 'IconLinkExternal', 'IconArrowDownLine',
]);

const parse = (markup: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg || doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG');
  }

  return svg;
};

describe('Blok Line authoring contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(entries)('%s keeps its intrinsic grid and decorative accessibility', (name, markup) => {
    const svg = parse(markup);
    const grid = overlays.has(name) ? 24 : 20;

    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${grid} ${grid}`);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('text, image, use, style, filter, foreignObject')).toBeNull();

    for (const node of [svg, ...svg.querySelectorAll('*')]) {
      for (const paint of ['fill', 'stroke']) {
        expect([null, 'none', 'currentColor']).toContain(node.getAttribute(paint));
      }

      expect(node.hasAttribute('opacity')).toBe(false);
      expect(node.hasAttribute('fill-opacity')).toBe(false);
      expect(node.hasAttribute('stroke-opacity')).toBe(false);
    }
  });

  it.each(entries)('%s uses the family weight, with named small-size corrections only', (name, markup) => {
    const svg = parse(markup);
    const widths = [svg, ...svg.querySelectorAll('[stroke-width]')]
      .map(node => node.getAttribute('stroke-width'))
      .filter((width): width is string => width !== null)
      .map(Number);
    let allowed = [overlays.has(name) ? 1.5 : 1.25];

    if (name.match(/^Icon(?:Toggle)?H[1-6]$/) !== null || ['IconSuperscript', 'IconSubscript'].includes(name)) {
      allowed = [1.25, 1.1, 1.05];
    } else if (name === 'IconListNumbered') {
      allowed = [1.25, 1.05];
    }

    const solidControls = [
      'IconMenu', 'IconDotsHorizontal', 'IconPlacement',
      'IconPlayerPlay', 'IconPlayerPause', 'IconPlayerBackward', 'IconPlayerForward',
    ];

    if (!solidControls.includes(name)) {
      expect(widths.length, `${name}: outlines must not become solid silhouettes`).toBeGreaterThan(0);
    }

    for (const width of widths) {
      expect(allowed, `${name}: unexpected stroke ${width}`).toContain(width);
    }
  });

  it('uses rotationally equivalent disclosure chevrons', () => {
    const expected = [
      [icons.IconChevronRight, 'M8 6L12 10L8 14'],
      [icons.IconChevronLeft, 'M12 6L8 10L12 14'],
      [icons.IconChevronDown, 'M6 8L10 12L14 8'],
    ];

    for (const [markup, path] of expected) {
      expect(parse(markup).querySelector('path')?.getAttribute('d')).toBe(path);
    }
  });

  it('rounds the exposed ends of the rear copy sheet', () => {
    const path = parse(icons.IconCopy).querySelector('path');

    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(parse(icons.IconCopy).querySelector('rect')?.getAttribute('rx')).toBe('2');
  });

  it('keeps a full stroke of space between the trash ribs and body', () => {
    const paths = Array.from(parse(icons.IconTrash).querySelectorAll('path'));
    const body = paths.find(path => path.getAttribute('d')?.startsWith('M5.5 6'));
    const ribs = paths.find(path => path.getAttribute('d')?.startsWith('M8.5 9.5'));

    expect(body).toBeDefined();
    expect(ribs).toBeDefined();
    // Upright sides at 5.5 / 14.5 leave 1.75 units of clear space around the ribs.
    expect(body?.getAttribute('d')).toContain('h5');
    expect(ribs?.getAttribute('d')).toBe('M8.5 9.5v3.5M11.5 9.5v3.5');
  });
});
