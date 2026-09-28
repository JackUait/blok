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

const labelOf = (element: HTMLElement): string =>
  element.querySelector('[data-blok-placement-label]')?.textContent ?? '';

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
    expect(labelOf(element)).toBe({ 'middle-left': 'Middle left', 'middle-center': 'Center', 'middle-right': 'Middle right' }[expected]);
  });

  it('parks the thumb under the checked option', () => {
    expect(thumbOf(render('top-left')).style.transform).toBe('translateX(0%)');
    document.body.replaceChildren();
    expect(thumbOf(render('bottom-center')).style.transform).toBe('translateX(100%)');
    document.body.replaceChildren();
    expect(thumbOf(render('middle-right')).style.transform).toBe('translateX(200%)');
  });

  it('selecting an option reports it, checks it, slides the thumb and renames the label', () => {
    const element = render('top-left', onPlacementSelect);
    const [, center, right] = radios(element);

    center.click();

    expect(onPlacementSelect).toHaveBeenLastCalledWith('middle-center');
    expect(checked(element)).toBe('middle-center');
    expect(thumbOf(element).style.transform).toBe('translateX(100%)');
    expect(labelOf(element)).toBe('Center');

    right.click();

    expect(onPlacementSelect).toHaveBeenLastCalledWith('middle-right');
    expect(checked(element)).toBe('middle-right');
    expect(thumbOf(element).style.transform).toBe('translateX(200%)');
    expect(labelOf(element)).toBe('Middle right');
    expect(onPlacementSelect).toHaveBeenCalledTimes(2);
  });

  it('previews the hovered option in the label and restores the checked one on leave', () => {
    const element = render('middle-center');
    const [left] = radios(element);

    left.dispatchEvent(new PointerEvent('pointerenter'));
    expect(labelOf(element)).toBe('Middle left');

    left.dispatchEvent(new PointerEvent('pointerleave'));
    expect(labelOf(element)).toBe('Center');
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

  describe('reflow animation', () => {
    const linesOf = (radio: HTMLElement): HTMLElement[] =>
      Array.from(radio.querySelectorAll<HTMLElement>('[data-blok-placement-glyph] > *'));

    const stubMotion = (reduced: boolean): Mock => {
      const animate = vi.fn();

      // jsdom has neither matchMedia nor element.animate.
      Object.defineProperty(window, 'matchMedia', {
        value: (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }),
        configurable: true,
        writable: true,
      });
      Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true });

      return animate;
    };

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      Reflect.deleteProperty(window, 'matchMedia');
    });

    it('springs the new option\'s text lines over from the old alignment, one after another', () => {
      const animate = stubMotion(false);
      const element = render('middle-left');
      const [, center] = radios(element);

      center.click();

      const lines = linesOf(center);

      expect(animate).toHaveBeenCalledTimes(3);
      animate.mock.contexts.forEach((context, index) => {
        const width = Number.parseFloat(lines[index].style.width);
        // From left-aligned (offset 0) to centred (offset (22 - width) / 2).
        const [frames, timing] = animate.mock.calls[index];

        expect(context).toBe(lines[index]);
        expect(frames).toEqual([{ transform: `translateX(${-(22 - width) / 2}px)` }, { transform: 'translateX(0)' }]);
        expect(timing.delay).toBe(index * 40);
      });
    });

    it('does not animate when the option is already checked', () => {
      const animate = stubMotion(false);
      const [left] = radios(render('middle-left'));

      left.click();

      expect(animate).not.toHaveBeenCalled();
    });

    it('stands still for people who ask for reduced motion', () => {
      const animate = stubMotion(true);
      const [, , right] = radios(render('middle-left'));

      right.click();

      expect(animate).not.toHaveBeenCalled();
    });
  });

  it('draws each option as text lines aligned to its own side', () => {
    const element = render(undefined);
    const alignments = radios(element).map(radio =>
      radio.querySelector<HTMLElement>('[data-blok-placement-glyph]')?.style.alignItems);

    expect(alignments).toEqual(['flex-start', 'center', 'flex-end']);
  });
});
