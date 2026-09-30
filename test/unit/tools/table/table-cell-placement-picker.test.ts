import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createCellPlacementPicker } from '../../../../src/tools/table/table-cell-placement-picker';
import type { CellPlacement } from '../../../../src/tools/table/types';

const LABELS: Record<string, string> = {
  'tools.table.placement': 'Alignment',
  'tools.table.placementTopLeft': 'Top left',
  'tools.table.placementTopCenter': 'Top center',
  'tools.table.placementTopRight': 'Top right',
  'tools.table.placementMiddleLeft': 'Middle left',
  'tools.table.placementMiddleCenter': 'Center',
  'tools.table.placementMiddleRight': 'Middle right',
  'tools.table.placementBottomLeft': 'Bottom left',
  'tools.table.placementBottomCenter': 'Bottom center',
  'tools.table.placementBottomRight': 'Bottom right',
};

const mockI18n = {
  t: (key: string): string => LABELS[key] ?? key,
} as Parameters<typeof createCellPlacementPicker>[0]['i18n'];

const ALL: CellPlacement[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const render = (currentPlacement: CellPlacement | undefined, onPlacementSelect: (placement: CellPlacement) => void = vi.fn()): HTMLElement => {
  const { element } = createCellPlacementPicker({ i18n: mockI18n, currentPlacement, onPlacementSelect });

  document.body.appendChild(element);

  return element;
};

const radios = (element: HTMLElement): HTMLButtonElement[] =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

const radio = (element: HTMLElement, placement: CellPlacement): HTMLButtonElement => {
  const found = element.querySelector<HTMLButtonElement>(`[role="radio"][data-placement="${placement}"]`);

  if (found === null) {
    throw new Error(`Missing ${placement}`);
  }

  return found;
};

const checked = (element: HTMLElement): string | null =>
  element.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('data-placement') ?? null;

const thumbOf = (element: HTMLElement): HTMLElement => {
  const thumb = element.querySelector<HTMLElement>('[data-blok-placement-thumb]');

  if (thumb === null) {
    throw new Error('Missing selection thumb');
  }

  return thumb;
};

describe('createCellPlacementPicker', () => {
  let onPlacementSelect: Mock<(placement: CellPlacement) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    onPlacementSelect = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('offers all nine placements, row by row, as a named radio group', () => {
    const element = render(undefined);
    const group = element.querySelector('[role="radiogroup"]');

    expect(group?.getAttribute('aria-label')).toBe('Alignment');
    expect(radios(element).map(option => option.getAttribute('data-placement'))).toEqual(ALL);
    expect(radios(element).map(option => option.getAttribute('aria-label'))).toEqual([
      'Top left', 'Top center', 'Top right',
      'Middle left', 'Center', 'Middle right',
      'Bottom left', 'Bottom center', 'Bottom right',
    ]);
  });

  it('uses real buttons, so each option is a keyboard stop inside the popover', () => {
    expect(radios(render(undefined))).toHaveLength(9);

    for (const option of radios(document.body)) {
      expect(option.tagName).toBe('BUTTON');
      expect(option.type).toBe('button');
    }
  });

  it('checks top-left, the default, when the cell has no placement', () => {
    expect(checked(render(undefined))).toBe('top-left');
  });

  it.each(ALL)('checks exactly the current placement %s', placement => {
    const element = render(placement);

    expect(checked(element)).toBe(placement);
    expect(element.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
  });

  it.each([
    ['top-left', 'translate(0%, 0%)'],
    ['top-right', 'translate(200%, 0%)'],
    ['middle-center', 'translate(100%, 100%)'],
    ['bottom-left', 'translate(0%, 200%)'],
    ['bottom-right', 'translate(200%, 200%)'],
  ] as const)('parks the thumb under %s', (placement, transform) => {
    expect(thumbOf(render(placement)).style.transform).toBe(transform);
  });

  it('selecting an option reports it, checks it and slides the thumb in both directions', () => {
    const element = render('top-left', onPlacementSelect);

    radio(element, 'bottom-center').click();

    expect(onPlacementSelect).toHaveBeenLastCalledWith('bottom-center');
    expect(checked(element)).toBe('bottom-center');
    expect(thumbOf(element).style.transform).toBe('translate(100%, 200%)');

    radio(element, 'middle-right').click();

    expect(onPlacementSelect).toHaveBeenLastCalledWith('middle-right');
    expect(thumbOf(element).style.transform).toBe('translate(200%, 100%)');
    expect(onPlacementSelect).toHaveBeenCalledTimes(2);
  });

  it('shows no text label: the preview shows the choice and each radio carries its name', () => {
    expect(render(undefined).querySelector('[data-blok-placement-label]')).toBeNull();
  });

  it('never marks the selection in blue: the option keeps its look and a neutral thumb carries the state', () => {
    const element = render('middle-center');
    const thumb = thumbOf(element);

    expect(radio(element, 'middle-center').className).toBe(radio(element, 'top-left').className);
    expect(radio(element, 'middle-center').style.backgroundColor).toBe('');
    expect(thumb.className).toContain('bg-icon-active-bg');
    expect(thumb.className).not.toMatch(/blue|primary|focus/);
  });

  it('slides the thumb fast, accelerating then braking without overshoot, and stands still for reduced motion', () => {
    const { className } = thumbOf(render(undefined));

    expect(className).toContain('transition-transform');
    expect(className).toContain('duration-[240ms]');
    expect(className).toContain('cubic-bezier(0.7,0,0.2,1)');
    expect(className).not.toContain('1.56');
    expect(className).toContain('motion-reduce:transition-none');
  });

  it('draws each option as text lines placed at its own corner, edge or centre', () => {
    const element = render(undefined);
    const glyphs = radios(element).map(option => option.querySelector<HTMLElement>('[data-blok-placement-glyph]'));

    expect(glyphs.map(glyph => [glyph?.style.justifyContent, glyph?.style.alignItems])).toEqual([
      ['flex-start', 'flex-start'], ['flex-start', 'center'], ['flex-start', 'flex-end'],
      ['center', 'flex-start'], ['center', 'center'], ['center', 'flex-end'],
      ['flex-end', 'flex-start'], ['flex-end', 'center'], ['flex-end', 'flex-end'],
    ]);
  });

  it('frames each option as a tiny outlined cell with whole-pixel lines, so its row reads at 16px', () => {
    for (const option of radios(render(undefined))) {
      const glyph = option.querySelector<HTMLElement>('[data-blok-placement-glyph]');

      expect(glyph?.classList.contains('border')).toBe(true);
      for (const line of Array.from(glyph?.children ?? [])) {
        expect(line.classList.contains('h-[2px]')).toBe(true);
      }
    }
  });

  describe('live cell preview', () => {
    const previewOf = (element: HTMLElement): HTMLElement => {
      const preview = element.querySelector<HTMLElement>('[data-blok-placement-preview]');

      if (preview === null) {
        throw new Error('Missing cell preview');
      }

      return preview;
    };

    const shifts = (element: HTMLElement): string[] =>
      Array.from(previewOf(element).querySelectorAll<HTMLElement>('[data-blok-placement-preview-line]'))
        .map(line => line.style.transform);

    const drop = (element: HTMLElement): string =>
      previewOf(element).querySelector<HTMLElement>('[data-blok-placement-preview-text]')?.style.transform ?? '';

    it('is decorative: hidden from assistive tech, which reads the radios instead', () => {
      expect(previewOf(render(undefined)).getAttribute('aria-hidden')).toBe('true');
    });

    it('is a soft card as wide and as round as the options track, with no borders', () => {
      const element = render(undefined);
      const preview = previewOf(element);
      const track = element.querySelector('[role="radiogroup"]');

      expect(preview.parentElement).toBe(track?.parentElement);
      expect(preview.classList.contains('rounded-(--blok-radius-control-lg)')).toBe(true);
      expect(track?.classList.contains('rounded-(--blok-radius-control-lg)')).toBe(true);
      expect(Array.from(preview.classList).filter(name => /^border|border-/.test(name))).toEqual([]);
    });

    it('rounds the thumb and options concentric with the track they sit in', () => {
      const element = render(undefined);
      const track = element.querySelector('[role="radiogroup"]');
      const thumb = element.querySelector('[data-blok-placement-thumb]');
      const options = Array.from(element.querySelectorAll('[role="radio"]'));

      expect(track?.classList.contains('p-(--blok-space-0-75)')).toBe(true);
      expect(track?.classList.contains(
        '[--blok-radius-inner:max(var(--blok-radius-floor),calc(var(--blok-radius-control-lg)-var(--blok-space-0-75)))]'
      )).toBe(true);
      expect(thumb?.classList.contains('rounded-(--blok-radius-inner)')).toBe(true);
      expect(options.length).toBe(9);
      expect(options.every(option => option.classList.contains('rounded-(--blok-radius-inner)'))).toBe(true);
    });

    it.each([
      ['top-left', ['translateX(0px)', 'translateX(0px)', 'translateX(0px)'], 'translateY(12px)'],
      ['middle-center', ['translateX(26px)', 'translateX(46px)', 'translateX(34px)'], 'translateY(30px)'],
      ['bottom-right', ['translateX(52px)', 'translateX(92px)', 'translateX(68px)'], 'translateY(48px)'],
    ] as const)('lays the cell text out %s', (placement, expected, vertical) => {
      const element = render(placement);

      expect(shifts(element)).toEqual(expected);
      expect(drop(element)).toBe(vertical);
    });

    it('glides to the hovered option and back to the checked one on leave', () => {
      const element = render('top-left');
      const target = radio(element, 'bottom-right');

      target.dispatchEvent(new PointerEvent('pointerenter'));
      expect(shifts(element)[1]).toBe('translateX(92px)');
      expect(drop(element)).toBe('translateY(48px)');

      target.dispatchEvent(new PointerEvent('pointerleave'));
      expect(shifts(element)[1]).toBe('translateX(0px)');
      expect(drop(element)).toBe('translateY(12px)');
    });

    it('stays on a picked option after the pointer leaves it', () => {
      const element = render('top-left');
      const target = radio(element, 'middle-center');

      target.dispatchEvent(new PointerEvent('pointerenter'));
      target.click();
      target.dispatchEvent(new PointerEvent('pointerleave'));

      expect(shifts(element)[1]).toBe('translateX(46px)');
      expect(drop(element)).toBe('translateY(30px)');
    });

    it('moves the text together, accelerating then braking without overshoot, and stands still for reduced motion', () => {
      const preview = previewOf(render(undefined));
      const moving = [
        ...preview.querySelectorAll<HTMLElement>('[data-blok-placement-preview-line]'),
        preview.querySelector<HTMLElement>('[data-blok-placement-preview-text]'),
      ];

      for (const part of moving) {
        expect(part?.style.transitionDelay).toBe('');
        expect(part?.className).toContain('transition-transform');
        expect(part?.className).toContain('duration-[240ms]');
        expect(part?.className).toContain('cubic-bezier(0.7,0,0.2,1)');
        expect(part?.className).toContain('motion-reduce:transition-none');
      }
    });
  });
});
