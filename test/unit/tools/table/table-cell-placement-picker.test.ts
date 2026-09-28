import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createCellPlacementPicker } from '../../../../src/tools/table/table-cell-placement-picker';
import type { CellPlacement } from '../../../../src/tools/table/types';

const mockI18n = {
  t: (key: string): string => {
    const map: Record<string, string> = {
      'tools.table.placement': 'Alignment',
      'tools.table.placementMiddleLeft': 'Middle left',
      'tools.table.placementMiddleCenter': 'Center',
      'tools.table.placementMiddleRight': 'Middle right',
    };

    return map[key] ?? key;
  },
} as Parameters<typeof createCellPlacementPicker>[0]['i18n'];

const render = (currentPlacement: CellPlacement | undefined, onPlacementSelect: (placement: CellPlacement) => void = vi.fn()): HTMLElement => {
  const { element } = createCellPlacementPicker({ i18n: mockI18n, currentPlacement, onPlacementSelect });

  document.body.appendChild(element);

  return element;
};

const radios = (element: HTMLElement): HTMLButtonElement[] =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

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

  it('offers only the middle row — left, center, right — as a named radio group', () => {
    const element = render(undefined);
    const group = element.querySelector('[role="radiogroup"]');

    expect(group?.getAttribute('aria-label')).toBe('Alignment');
    expect(radios(element).map(radio => radio.getAttribute('data-placement'))).toEqual([
      'middle-left', 'middle-center', 'middle-right',
    ]);
    expect(radios(element).map(radio => radio.getAttribute('aria-label'))).toEqual(['Middle left', 'Center', 'Middle right']);
  });

  it('uses real buttons, so each option is a keyboard stop inside the popover', () => {
    expect(radios(render(undefined))).toHaveLength(3);

    for (const radio of radios(document.body)) {
      expect(radio.tagName).toBe('BUTTON');
      expect(radio.type).toBe('button');
    }
  });

  it.each([
    [undefined, 'middle-left'],
    ['top-left', 'middle-left'],
    ['middle-center', 'middle-center'],
    ['bottom-center', 'middle-center'],
    ['top-right', 'middle-right'],
    ['bottom-right', 'middle-right'],
  ] as const)('checks the option on the same side as the current placement %s', (current, expected) => {
    const element = render(current);

    expect(checked(element)).toBe(expected);
    expect(element.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
  });

  it('parks the thumb under the checked option', () => {
    expect(thumbOf(render('top-left')).style.transform).toBe('translateX(0%)');
    document.body.replaceChildren();
    expect(thumbOf(render('bottom-center')).style.transform).toBe('translateX(100%)');
    document.body.replaceChildren();
    expect(thumbOf(render('middle-right')).style.transform).toBe('translateX(200%)');
  });

  it('selecting an option reports it, checks it and slides the thumb', () => {
    const element = render('top-left', onPlacementSelect);
    const [, center, right] = radios(element);

    center.click();

    expect(onPlacementSelect).toHaveBeenLastCalledWith('middle-center');
    expect(checked(element)).toBe('middle-center');
    expect(thumbOf(element).style.transform).toBe('translateX(100%)');

    right.click();

    expect(onPlacementSelect).toHaveBeenLastCalledWith('middle-right');
    expect(checked(element)).toBe('middle-right');
    expect(thumbOf(element).style.transform).toBe('translateX(200%)');
    expect(onPlacementSelect).toHaveBeenCalledTimes(2);
  });

  it('shows no text label: the preview shows the choice and each radio carries its name', () => {
    expect(render(undefined).querySelector('[data-blok-placement-label]')).toBeNull();
  });

  it('never marks the selection in blue: the option keeps its look and a neutral thumb carries the state', () => {
    const element = render('middle-center');
    const [left, center] = radios(element);
    const thumb = thumbOf(element);

    expect(center.className).toBe(left.className);
    expect(center.style.backgroundColor).toBe('');
    expect(thumb.className).toContain('bg-icon-active-bg');
    expect(thumb.className).not.toMatch(/blue|primary|focus/);
  });

  it('lets the thumb spring, but stands still for people who ask for reduced motion', () => {
    const { className } = thumbOf(render(undefined));

    expect(className).toContain('transition-transform');
    expect(className).toContain('motion-reduce:transition-none');
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

    it('is decorative: hidden from assistive tech, which reads the radios instead', () => {
      expect(previewOf(render(undefined)).getAttribute('aria-hidden')).toBe('true');
    });

    it('is a soft card as wide and as round as the options track, with no borders', () => {
      const element = render(undefined);
      const preview = previewOf(element);
      const track = element.querySelector('[role="radiogroup"]');

      expect(preview.parentElement).toBe(track?.parentElement);
      expect(preview.classList.contains('rounded-[10px]')).toBe(true);
      expect(track?.classList.contains('rounded-[10px]')).toBe(true);
      expect(Array.from(preview.classList).filter(name => /^border|border-/.test(name))).toEqual([]);
      expect(preview.querySelector('[data-blok-placement-guide]')).toBeNull();
    });

    it.each([
      ['middle-left', ['translateX(0px)', 'translateX(0px)', 'translateX(0px)']],
      ['middle-center', ['translateX(26px)', 'translateX(46px)', 'translateX(34px)']],
      ['middle-right', ['translateX(52px)', 'translateX(92px)', 'translateX(68px)']],
    ] as const)('lays the cell text out %s', (placement, expected) => {
      expect(shifts(render(placement))).toEqual(expected);
    });

    it('glides to the hovered option and back to the checked one on leave', () => {
      const element = render('middle-left');
      const [, , right] = radios(element);

      right.dispatchEvent(new PointerEvent('pointerenter'));
      expect(shifts(element)[1]).toBe('translateX(92px)');

      right.dispatchEvent(new PointerEvent('pointerleave'));
      expect(shifts(element)[1]).toBe('translateX(0px)');
    });

    it('stays on a picked option after the pointer leaves it', () => {
      const element = render('middle-left');
      const [, center] = radios(element);

      center.dispatchEvent(new PointerEvent('pointerenter'));
      center.click();
      center.dispatchEvent(new PointerEvent('pointerleave'));

      expect(shifts(element)[1]).toBe('translateX(46px)');
    });

    it('staggers the lines on a spring, and stands still for reduced motion', () => {
      const lines = Array.from(previewOf(render(undefined)).querySelectorAll<HTMLElement>('[data-blok-placement-preview-line]'));

      expect(lines.map(line => line.style.transitionDelay)).toEqual(['0ms', '40ms', '80ms']);
      for (const line of lines) {
        expect(line.className).toContain('transition-transform');
        expect(line.className).toContain('motion-reduce:transition-none');
      }
    });
  });

  it('draws each option as text lines aligned to its own side', () => {
    const element = render(undefined);
    const alignments = radios(element).map(radio =>
      radio.querySelector<HTMLElement>('[data-blok-placement-glyph]')?.style.alignItems);

    expect(alignments).toEqual(['flex-start', 'center', 'flex-end']);
  });
});
