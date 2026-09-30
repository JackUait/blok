import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

/**
 * Every Blok text field shares one look (the "Turn into" menu's search field):
 * a filled rounded box, 28px tall on desktop and 36px on phones, a transparent
 * 1px border that takes the popover border color on focus, never a halo.
 * Search fields add the search glyph.
 * @param field - the element carrying `data-blok-field`
 * @param input - the text input inside it (or the field itself)
 * @param kind - 'search' adds the glyph, 'text' has none
 * @param options.multiline - a textarea field grows with its rows, so it is at least one line tall
 * @param options.height - a field drawn in a larger size on purpose (the media Link tab's 48px field)
 * @param options.radius - a field at a rounded card's corner takes the card's inner radius instead of the field role
 */
export const expectBlokField = async (
  field: Locator,
  input: Locator,
  kind: 'search' | 'text',
  options: { multiline?: boolean; height?: number; radius?: string } = {}
): Promise<void> => {
  await expect(field).toHaveAttribute('data-blok-field', kind);
  await input.blur();

  const rest = await field.evaluate(element => {
    const probe = document.createElement('span');

    probe.style.backgroundColor = 'var(--blok-item-hover-bg)';
    element.parentElement?.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;

    probe.remove();
    const style = getComputedStyle(element);
    const glyph = getComputedStyle(element, '::before');

    return {
      fill,
      background: style.backgroundColor,
      radius: style.borderTopLeftRadius,
      borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      height: element instanceof HTMLElement ? element.offsetHeight : 0,
      glyphWidth: glyph.content === 'none' ? 0 : parseFloat(glyph.width) || 0,
      phone: window.innerWidth < 651,
    };
  });

  expect(rest.background, 'filled at rest').toBe(rest.fill);
  expect(rest.radius).toBe(options.radius ?? '8px');
  expect(rest.borders).toEqual(['1px', '1px', '1px', '1px']);
  const lineHeight = options.height ?? (rest.phone ? 36 : 28);

  if (options.multiline === true) {
    expect(rest.height).toBeGreaterThanOrEqual(lineHeight);
  } else {
    expect(rest.height).toBe(lineHeight);
  }
  expect(rest.glyphWidth).toBe(kind === 'search' ? 16 : 0);

  // A wrapped input draws no box of its own; the field is the box.
  const inner = await input.evaluate((element, fieldHandle) => {
    if (element === fieldHandle) {
      return { background: 'rgba(0, 0, 0, 0)', border: '0px' };
    }
    const style = getComputedStyle(element);

    return { background: style.backgroundColor, border: style.borderTopWidth };
  }, await field.elementHandle());

  expect(inner).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });

  await input.focus();
  const focused = await field.evaluate(element => {
    const probe = document.createElement('span');

    probe.style.borderColor = 'var(--blok-popover-border)';
    element.parentElement?.append(probe);
    const border = getComputedStyle(probe).borderTopColor;

    probe.remove();
    const style = getComputedStyle(element);

    return { border, borderColor: style.borderTopColor, background: style.backgroundColor, shadow: style.boxShadow };
  });

  expect(focused.borderColor, 'focus darkens the border').toBe(focused.border);
  expect(focused.background).toBe('rgba(0, 0, 0, 0)');
  expect(focused.shadow, 'no focus halo').toBe('none');
};
