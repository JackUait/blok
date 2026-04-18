import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderIconGallery } from '../../../src/playground/icon-gallery';

const ICONS: Record<string, string> = {
  IconCheck: '<svg data-icon="check"><path /></svg>',
  IconCross: '<svg data-icon="cross"><path /></svg>',
};

const GROUPS: Record<string, string[]> = {
  'UI & Navigation': ['IconCheck', 'IconCross'],
};

const LIGHTBOX_TESTID = 'icon-lightbox';

describe('playground icon gallery', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)?.remove();
    vi.restoreAllMocks();
  });

  test('clicking an icon cell opens a lightbox with the icon preview and name', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    const cells = container.querySelectorAll<HTMLElement>('.icon-cell');

    expect(cells.length).toBe(2);

    cells[0].click();

    const lightbox = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"]`);

    expect(lightbox).not.toBeNull();
    expect(lightbox?.textContent).toContain('IconCheck');
    expect(lightbox?.querySelector('svg[data-icon="check"]')).not.toBeNull();
  });

  test('clicking an icon does not copy the name to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    const cell = container.querySelector<HTMLElement>('.icon-cell');

    cell?.click();

    expect(writeText).not.toHaveBeenCalled();
  });

  test('pressing Escape closes the lightbox', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).toBeNull();
  });

  test('clicking the backdrop closes the lightbox', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const lightbox = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"]`);

    expect(lightbox).not.toBeNull();

    lightbox?.click();

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).toBeNull();
  });

  test('clicking inside the lightbox content does not close the lightbox', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const content = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__content`);

    expect(content).not.toBeNull();

    content?.click();

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).not.toBeNull();
  });
});
