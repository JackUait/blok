import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderIconGallery } from '../../../src/playground/icon-gallery';
import { simulateKeydown, simulateInput } from '../../helpers/simulate';

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

  test('pressing Escape starts closing animation then removes lightbox on animationend', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const lightbox = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"]`);

    expect(lightbox).not.toBeNull();

    simulateKeydown(document, 'Escape');

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).toBe(lightbox);
    expect(lightbox?.classList.contains('icon-lightbox--closing')).toBe(true);

    const content = lightbox?.querySelector<HTMLElement>('.icon-lightbox__content');

    content?.dispatchEvent(new Event('animationend'));

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).toBeNull();
  });

  test('clicking the backdrop starts closing animation', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const lightbox = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"]`);

    expect(lightbox).not.toBeNull();

    lightbox?.click();

    expect(document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)).toBe(lightbox);
    expect(lightbox?.classList.contains('icon-lightbox--closing')).toBe(true);

    const content = lightbox?.querySelector<HTMLElement>('.icon-lightbox__content');

    content?.dispatchEvent(new Event('animationend'));

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

  test('clicking copy-svg button writes svg markup to clipboard and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const copySvg = document.querySelector<HTMLButtonElement>(`[data-testid="${LIGHTBOX_TESTID}"] [data-action="copy-svg"]`);

    expect(copySvg).not.toBeNull();

    copySvg?.click();

    expect(writeText).toHaveBeenCalledWith(ICONS.IconCheck);

    await Promise.resolve();

    const feedback = document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"] [data-testid="icon-lightbox-feedback"]`);

    expect(feedback?.textContent).toContain('Copied');
  });

  test('clicking copy-name button writes icon name to clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const copyName = document.querySelector<HTMLButtonElement>(`[data-testid="${LIGHTBOX_TESTID}"] [data-action="copy-name"]`);

    expect(copyName).not.toBeNull();

    copyName?.click();

    expect(writeText).toHaveBeenCalledWith('IconCheck');
  });

  test('opening the lightbox sets explicit svg width/height attrs to the default size', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const svgEl = document.querySelector<SVGElement>(`[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__preview svg`);

    expect(svgEl?.getAttribute('width')).toBe('96');
    expect(svgEl?.getAttribute('height')).toBe('96');
  });

  test('size slider updates preview svg dimensions', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const slider = document.querySelector<HTMLInputElement>(`[data-testid="${LIGHTBOX_TESTID}"] [data-control="size"]`);

    expect(slider).not.toBeNull();
    expect(slider?.type).toBe('range');

    if (slider) {
      slider.value = '48';
      simulateInput(slider);
    }

    const svgEl = document.querySelector<SVGElement>(`[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__preview svg`);

    expect(svgEl?.getAttribute('width')).toBe('48');
    expect(svgEl?.getAttribute('height')).toBe('48');
  });

  test('color picker updates preview color style', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const color = document.querySelector<HTMLInputElement>(`[data-testid="${LIGHTBOX_TESTID}"] [data-control="color"]`);

    expect(color).not.toBeNull();
    expect(color?.type).toBe('color');

    if (color) {
      color.value = '#ff0000';
      simulateInput(color);
    }

    const preview = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__preview`);

    expect(preview?.style.color).toBe('rgb(255, 0, 0)');
  });

  test('clicking download builds an svg blob URL, triggers the download, then revokes it', () => {
    const createdBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);

      return 'blob:mock-url';
    });
    const revokeObjectURL = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const download = document.querySelector<HTMLButtonElement>(`[data-testid="${LIGHTBOX_TESTID}"] [data-action="download"]`);

    expect(download).not.toBeNull();

    download?.click();

    // The blob carries the icon's SVG markup as image/svg+xml.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdBlobs[0]?.type).toBe('image/svg+xml');

    // The generated object URL is revoked once the download has been triggered.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    // The download surfaces user-visible feedback once complete.
    const feedback = document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"] [data-testid="icon-lightbox-feedback"]`);

    expect(feedback?.textContent).toContain('Downloaded');
  });

  test('background toggle cycles preview background', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const preview = document.querySelector<HTMLElement>(`[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__preview`);
    const toggle = document.querySelector<HTMLButtonElement>(`[data-testid="${LIGHTBOX_TESTID}"] [data-action="toggle-bg"]`);

    expect(toggle).not.toBeNull();
    expect(preview?.getAttribute('data-bg')).toBe('transparent');

    toggle?.click();
    expect(preview?.getAttribute('data-bg')).toBe('light');

    toggle?.click();
    expect(preview?.getAttribute('data-bg')).toBe('dark');

    toggle?.click();
    expect(preview?.getAttribute('data-bg')).toBe('transparent');
  });

  test('ArrowRight advances lightbox to next icon; ArrowLeft wraps from first to last', () => {
    renderIconGallery({ container, iconGroups: GROUPS, icons: ICONS });

    container.querySelector<HTMLElement>('.icon-cell')?.click();

    const getName = (): string | undefined => document.querySelector<HTMLElement>(
      `[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__name`
    )?.textContent ?? undefined;
    const getSvgMarker = (): string | null | undefined => document.querySelector<SVGElement>(
      `[data-testid="${LIGHTBOX_TESTID}"] .icon-lightbox__preview svg`
    )?.getAttribute('data-icon');

    expect(getName()).toBe('IconCheck');
    expect(getSvgMarker()).toBe('check');

    simulateKeydown(document, 'ArrowRight');
    expect(getName()).toBe('IconCross');
    expect(getSvgMarker()).toBe('cross');

    simulateKeydown(document, 'ArrowRight');
    expect(getName()).toBe('IconCheck');

    simulateKeydown(document, 'ArrowLeft');
    expect(getName()).toBe('IconCross');
  });
});
