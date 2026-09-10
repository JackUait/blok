import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderIconGallery } from '../../../src/playground/icon-gallery';
import { simulateInput, simulateKeydown } from '../../helpers/simulate';

const LIGHTBOX_SELECTOR = '[data-testid="icon-lightbox"]';
const FEEDBACK_VISIBLE = 'icon-lightbox__feedback--visible';

/**
 * Every fixture carries distinct markup: identical SVG bodies compare equal and
 * would hide a mutant that renders the wrong entry.
 */
const ICON_SIZED = '<svg data-icon="sized" width="32" height="32"><path d="M1 1h2" /></svg>';
const ICON_BARE = '<svg data-icon="bare"><path d="M2 2h3" /></svg>';
const ICON_WIDE = '<svg data-icon="wide" width="48"><path d="M3 3h4" /></svg>';
const ICON_TALL = '<svg data-icon="tall" height="64"><path d="M4 4h5" /></svg>';
const ICON_PLAIN = '<em data-icon="plain">plain glyph</em>';

const ALL_ICONS: Record<string, string> = {
  IconSized: ICON_SIZED,
  IconBare: ICON_BARE,
  IconWide: ICON_WIDE,
  IconTall: ICON_TALL,
  IconPlain: ICON_PLAIN,
};

const ALL_GROUPS: Record<string, string[]> = {
  'Alpha glyphs': ['IconSized', 'IconBare'],
  'Beta glyphs': ['IconWide', 'IconTall'],
};

function must<T extends Element>(element: T | null, what: string): T {
  if (element === null) {
    throw new Error(`Expected ${what} to be present`);
  }

  return element;
}

function lightbox(): HTMLElement {
  return must(document.querySelector<HTMLElement>(LIGHTBOX_SELECTOR), 'the lightbox');
}

function openCell(container: HTMLElement, index: number): void {
  const cells = container.querySelectorAll<HTMLElement>('.icon-cell');

  must(cells[index] ?? null, `icon cell #${index}`).click();
}

function sizeButtons(): HTMLButtonElement[] {
  const controls = must(document.querySelector<HTMLElement>('.icon-gallery-controls'), 'gallery controls');

  return Array.from(controls.querySelectorAll<HTMLButtonElement>('button'));
}

function pressedStates(): string[] {
  return sizeButtons().map((button) => button.getAttribute('aria-pressed') ?? 'missing');
}

function clipboard(writeText: (value: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

function hideClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
}

describe('playground icon gallery — mutants', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.querySelector(LIGHTBOX_SELECTOR)?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('each group renders its own title, grid and only the cells whose icon exists', () => {
    const groups: Record<string, string[]> = {
      'Alpha glyphs': ['IconSized', 'IconBare'],
      'Beta glyphs': ['IconWide', 'IconMissing'],
    };

    renderIconGallery({ container, iconGroups: groups, icons: ALL_ICONS });

    const groupEls = Array.from(container.querySelectorAll<HTMLElement>('.icon-group'));

    expect(groupEls.length).toBe(2);

    const alpha = must(groupEls[0] ?? null, 'the alpha group');
    const beta = must(groupEls[1] ?? null, 'the beta group');

    expect(alpha.className).toBe('icon-group');

    const tile = must(alpha.firstElementChild, 'the group title');
    const grid = must(alpha.lastElementChild, 'the group grid');

    expect(tile.className).toBe('icon-group-title');
    expect(tile.textContent).toBe('Alpha glyphs');
    expect(grid.className).toBe('icon-grid');
    expect(grid.children.length).toBe(2);

    // A name with no matching svg must contribute no cell at all.
    const missingIconCells = must(beta.lastElementChild, 'the beta grid').children.length;

    expect(missingIconCells).toBe(1);
  });

  test('each cell holds a preview wrapper followed by the icon name', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    const cell = must(container.querySelector<HTMLElement>('.icon-cell'), 'the first icon cell');

    expect(cell.className).toBe('icon-cell');

    const preview = must(cell.firstElementChild, 'the cell preview');
    const name = must(cell.lastElementChild, 'the cell name');

    expect(preview.className).toBe('icon-preview');
    expect(name.className).toBe('icon-name');
    expect(name.textContent).toBe('IconSized');
    expect(name).not.toBe(preview);
  });

  test('previews get an explicit 20px size only when the svg declares neither dimension', () => {
    const icons: Record<string, string> = {
      IconSized: ICON_SIZED,
      IconBare: ICON_BARE,
      IconWide: ICON_WIDE,
      IconTall: ICON_TALL,
    };
    const groups: Record<string, string[]> = {
      'Mixed glyphs': ['IconSized', 'IconBare', 'IconWide', 'IconTall'],
    };

    renderIconGallery({ container, iconGroups: groups, icons });

    const sizeOf = (marker: string): string => {
      const svg = must(container.querySelector<SVGElement>(`svg[data-icon="${marker}"]`), `${marker} svg`);

      return `${svg.getAttribute('width') ?? 'null'}x${svg.getAttribute('height') ?? 'null'}`;
    };

    // Already sized by the icon itself: left alone.
    expect(sizeOf('sized')).toBe('32x32');
    // Bare: both dimensions defaulted.
    expect(sizeOf('bare')).toBe('20x20');
    // Only one dimension declared: the other stays absent until "Native" is pressed.
    expect(sizeOf('wide')).toBe('48xnull');
    expect(sizeOf('tall')).toBe('nullx64');
  });

  test('clicking a cell opens the lightbox for that very cell', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 1);

    const name = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__name'), 'the lightbox name');

    expect(name.textContent).toBe('IconBare');
    expect(lightbox().querySelector<SVGElement>('svg[data-icon="bare"]')).not.toBeNull();
  });

  test('the lightbox dialog carries the full visible chrome', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const dialog = must(document.querySelector<HTMLElement>(LIGHTBOX_SELECTOR), 'the lightbox dialog');

    expect(dialog.className).toBe('icon-lightbox');
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.getAttribute('data-testid')).toBe('icon-lightbox');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('IconSized preview');

    const content = must(dialog.querySelector<HTMLElement>('.icon-lightbox__content'), 'the lightbox content');

    expect(content.className).toBe('icon-lightbox__content');

    const preview = must(content.querySelector<HTMLElement>('.icon-lightbox__preview'), 'the lightbox preview');

    expect(preview.className).toBe('icon-lightbox__preview');
    expect(preview.getAttribute('data-bg')).toBe('transparent');

    const svg = must(preview.querySelector<SVGElement>('svg'), 'the previewed svg');

    expect(svg.getAttribute('width')).toBe('96');
    expect(svg.getAttribute('height')).toBe('96');

    const name = must(content.querySelector<HTMLElement>('.icon-lightbox__name'), 'the lightbox name');

    expect(name.textContent).toBe('IconSized');
    expect(name.className).toBe('icon-lightbox__name');

    const controls = must(content.querySelector<HTMLElement>('.icon-lightbox__controls'), 'the lightbox controls');

    expect(controls.className).toBe('icon-lightbox__controls');

    const fields = controls.querySelectorAll<HTMLElement>('.icon-lightbox__field');

    expect(fields.length).toBe(2);

    const sizeField = must(fields[0] ?? null, 'the size field');
    const colorField = must(fields[1] ?? null, 'the color field');

    expect(sizeField.tagName).toBe('LABEL');
    expect(colorField.className).toBe('icon-lightbox__field');

    const sizeLabel = must(sizeField.querySelector<HTMLElement>('.icon-lightbox__field-label'), 'the size caption');
    const sizeValue = must(sizeField.querySelector<HTMLElement>('.icon-lightbox__field-value'), 'the size readout');

    expect(sizeLabel.textContent).toBe('Size');
    expect(sizeLabel.className).toBe('icon-lightbox__field-label');
    expect(sizeValue.textContent).toBe('96');
    expect(sizeValue.className).toBe('icon-lightbox__field-value');

    // Both the caption and the readout sit inside the size field.
    expect(Array.from(sizeField.children)).toStrictEqual([sizeLabel, sizeField.querySelector('input'), sizeValue]);

    const slider = must(sizeField.querySelector<HTMLInputElement>('input'), 'the size slider');

    expect(slider.getAttribute('data-control')).toBe('size');
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('16');
    expect(slider.max).toBe('128');
    expect(slider.step).toBe('4');
    expect(slider.value).toBe('96');
    expect(slider.className).toBe('icon-lightbox__slider');

    const colorLabel = must(colorField.querySelector<HTMLElement>('.icon-lightbox__field-label'), 'the color caption');
    const colorInput = must(colorField.querySelector<HTMLInputElement>('input'), 'the color input');

    expect(colorLabel.textContent).toBe('Color');
    expect(colorField.children.length).toBe(2);
    expect(colorInput.type).toBe('color');
    expect(colorInput.value).toBe('#1a1a1a');
    expect(colorInput.className).toBe('icon-lightbox__color');
    expect(colorInput.getAttribute('data-control')).toBe('color');

    const toolbar = must(content.querySelector<HTMLElement>('.icon-lightbox__toolbar'), 'the lightbox toolbar');

    expect(toolbar.className).toBe('icon-lightbox__toolbar');
    expect(toolbar.children.length).toBe(4);

    const feedback = must(content.querySelector<HTMLElement>('.icon-lightbox__feedback'), 'the feedback strip');

    expect(feedback.className).toBe('icon-lightbox__feedback');
    expect(feedback.getAttribute('data-testid')).toBe('icon-lightbox-feedback');
    expect(feedback.textContent).toBe('');
  });

  test('the lightbox toolbar buttons carry their label, class and action', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const readButton = (action: string): HTMLButtonElement => must(
      lightbox().querySelector<HTMLButtonElement>(`[data-action="${action}"]`),
      `the ${action} button`
    );

    const copySvg = readButton('copy-svg');

    expect(copySvg.textContent).toBe('Copy SVG');
    expect(copySvg.className).toBe('icon-lightbox__btn');
    expect(copySvg.type).toBe('button');

    const copyName = readButton('copy-name');

    expect(copyName.textContent).toBe('Copy Name');
    expect(copyName.className).toBe('icon-lightbox__btn');
    expect(copyName.type).toBe('button');

    const download = readButton('download');

    expect(download.textContent).toBe('Download SVG');
    expect(download.className).toBe('icon-lightbox__btn');
    expect(download.type).toBe('button');

    const toggleBg = readButton('toggle-bg');

    expect(toggleBg.textContent).toBe('BG: transparent');
    expect(toggleBg.className).toBe('icon-lightbox__btn');
    expect(toggleBg.type).toBe('button');
  });

  test('the size slider rescales the preview and reports the raw value', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const slider = must(
      lightbox().querySelector<HTMLInputElement>('[data-control="size"]'),
      'the size slider'
    );

    slider.value = '48';
    simulateInput(slider);

    const svg = must(lightbox().querySelector<SVGElement>('.icon-lightbox__preview svg'), 'the previewed svg');

    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');

    const readout = must(
      lightbox().querySelector<HTMLElement>('.icon-lightbox__field-value'),
      'the size readout'
    );

    expect(readout.textContent).toBe('48');
  });

  test('the size slider still reports its value when the icon has no svg root', () => {
    const groups: Record<string, string[]> = { 'Plain glyphs': ['IconPlain'] };

    renderIconGallery({ container, iconGroups: groups, icons: ALL_ICONS });

    openCell(container, 0);

    const slider = must(
      lightbox().querySelector<HTMLInputElement>('[data-control="size"]'),
      'the size slider'
    );

    slider.value = '52';
    simulateInput(slider);

    const readout = must(
      lightbox().querySelector<HTMLElement>('.icon-lightbox__field-value'),
      'the size readout'
    );

    expect(readout.textContent).toBe('52');
  });

  test('a lightbox opens for an icon whose markup contains no svg root', () => {
    const groups: Record<string, string[]> = { 'Plain glyphs': ['IconPlain'] };

    renderIconGallery({ container, iconGroups: groups, icons: ALL_ICONS });

    openCell(container, 0);

    const name = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__name'), 'the lightbox name');

    expect(name.textContent).toBe('IconPlain');
    expect(lightbox().getAttribute('aria-label')).toBe('IconPlain preview');
  });

  test('the color input paints the preview with the chosen colour', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const colorInput = must(
      lightbox().querySelector<HTMLInputElement>('[data-control="color"]'),
      'the color input'
    );

    colorInput.value = '#ff0000';
    simulateInput(colorInput);

    const preview = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__preview'), 'the preview');

    expect(preview.style.color).toBe('rgb(255, 0, 0)');
    // The colour caption stays attached to the colour field.
    expect(lightbox().querySelectorAll('.icon-lightbox__field').length).toBe(2);
  });

  test('copy-svg writes the markup and flashes its own message', () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);

    clipboard(writeText);

    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const copySvg = must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="copy-svg"]'),
      'the copy-svg button'
    );

    copySvg.click();

    expect(writeText).toHaveBeenCalledWith(ICON_SIZED);

    const feedback = must(
      lightbox().querySelector<HTMLElement>('[data-testid="icon-lightbox-feedback"]'),
      'the feedback strip'
    );

    expect(feedback.textContent).toBe('Copied SVG');
    expect(feedback.classList.contains(FEEDBACK_VISIBLE)).toBe(true);
  });

  test('copy-name writes the icon name and flashes its own message', () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);

    clipboard(writeText);

    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const copyName = must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="copy-name"]'),
      'the copy-name button'
    );

    copyName.click();

    expect(writeText).toHaveBeenCalledWith('IconSized');

    const feedback = must(
      lightbox().querySelector<HTMLElement>('[data-testid="icon-lightbox-feedback"]'),
      'the feedback strip'
    );

    expect(feedback.textContent).toBe('Copied name');
  });

  test('copy still reports back when the clipboard API is unavailable', () => {
    hideClipboard();

    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="copy-svg"]'),
      'the copy-svg button'
    ).click();

    const feedback = must(
      lightbox().querySelector<HTMLElement>('[data-testid="icon-lightbox-feedback"]'),
      'the feedback strip'
    );

    expect(feedback.textContent).toBe('Copied SVG');

    must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="copy-name"]'),
      'the copy-name button'
    ).click();

    expect(feedback.textContent).toBe('Copied name');
  });

  test('download builds an svg blob, names the anchor after the icon and revokes the url', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:icon-url');
    const revokeObjectURL = vi.fn<(url: string) => void>();

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const realCreateElement = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string): HTMLElement => {
      const element = realCreateElement(tagName);

      if (element instanceof HTMLAnchorElement) {
        anchors.push(element);
      }

      return element;
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="download"]'),
      'the download button'
    ).click();

    expect(anchors.length).toBe(1);

    const anchor = must(anchors[0] ?? null, 'the download anchor');

    expect(anchor.download).toBe('IconSized.svg');
    expect(anchor.href).toBe('blob:icon-url');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const blobCall = createObjectURL.mock.calls[0];

    if (blobCall === undefined) {
      throw new Error('createObjectURL was not called');
    }

    const blob = blobCall[0];

    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe(ICON_SIZED);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:icon-url');

    const feedback = must(
      lightbox().querySelector<HTMLElement>('[data-testid="icon-lightbox-feedback"]'),
      'the feedback strip'
    );

    expect(feedback.textContent).toBe('Downloaded');
  });

  test('the background button cycles the preview backdrop and relabels itself', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const toggle = must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="toggle-bg"]'),
      'the toggle-bg button'
    );
    const preview = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__preview'), 'the preview');

    expect(preview.getAttribute('data-bg')).toBe('transparent');

    toggle.click();
    expect(preview.getAttribute('data-bg')).toBe('light');
    expect(toggle.textContent).toBe('BG: light');

    toggle.click();
    expect(preview.getAttribute('data-bg')).toBe('dark');
    expect(toggle.textContent).toBe('BG: dark');

    toggle.click();
    expect(preview.getAttribute('data-bg')).toBe('transparent');
    expect(toggle.textContent).toBe('BG: transparent');
  });

  test('feedback clears itself after 1400ms and a new message restarts the clock', () => {
    vi.useFakeTimers();

    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const feedback = must(
      lightbox().querySelector<HTMLElement>('[data-testid="icon-lightbox-feedback"]'),
      'the feedback strip'
    );
    const copySvg = must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="copy-svg"]'),
      'the copy-svg button'
    );
    const copyName = must(
      lightbox().querySelector<HTMLButtonElement>('[data-action="copy-name"]'),
      'the copy-name button'
    );

    copySvg.click();
    expect(feedback.classList.contains(FEEDBACK_VISIBLE)).toBe(true);

    vi.advanceTimersByTime(1000);
    copyName.click();

    // The first timer must be dropped, or it clears the class 400ms from now.
    vi.advanceTimersByTime(500);
    expect(feedback.classList.contains(FEEDBACK_VISIBLE)).toBe(true);
    expect(feedback.textContent).toBe('Copied name');

    vi.advanceTimersByTime(1000);
    expect(feedback.classList.contains(FEEDBACK_VISIBLE)).toBe(false);
  });

  test('Escape marks the dialog as closing and animationend removes it', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const dialog = lightbox();

    simulateKeydown(document, 'Escape');

    expect(dialog.classList.contains('icon-lightbox--closing')).toBe(true);

    must(dialog.querySelector<HTMLElement>('.icon-lightbox__content'), 'the content').dispatchEvent(
      new Event('animationend')
    );

    expect(document.querySelector(LIGHTBOX_SELECTOR)).toBeNull();
  });

  test('Escape detaches the paging keyboard so later arrows do nothing', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const dialog = lightbox();

    simulateKeydown(document, 'Escape');
    simulateKeydown(document, 'ArrowRight');

    expect(dialog.classList.contains('icon-lightbox--closing')).toBe(true);
    expect(lightbox()).toBe(dialog);
  });

  test('a closing dialog only acts on the first close request', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const dialog = lightbox();
    const removeSpy = vi.spyOn(dialog, 'remove');

    simulateKeydown(document, 'Escape');
    // The backdrop click is a second close request on an already-closing dialog.
    dialog.click();

    must(dialog.querySelector<HTMLElement>('.icon-lightbox__content'), 'the content').dispatchEvent(
      new Event('animationend')
    );

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  test('the closing animation handler is spent after its first run', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    const dialog = lightbox();
    const removeSpy = vi.spyOn(dialog, 'remove');

    simulateKeydown(document, 'Escape');

    const content = must(dialog.querySelector<HTMLElement>('.icon-lightbox__content'), 'the content');

    content.dispatchEvent(new Event('animationend'));
    // A second animation finishing inside the dialog must not remove it twice.
    content.dispatchEvent(new Event('animationend'));

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  test('a keypress that is not an arrow leaves the lightbox alone', () => {    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    simulateKeydown(document, 'a');

    const name = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__name'), 'the lightbox name');

    expect(name.textContent).toBe('IconSized');
  });

  test('ArrowLeft from the second of three icons steps back to the first', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    openCell(container, 0);

    // Three entries is the smallest count where +1 and -1 differ at index 1.
    openCell(container, 1);

    simulateKeydown(document, 'ArrowLeft');

    const name = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__name'), 'the lightbox name');

    expect(name.textContent).toBe('IconSized');
  });

  test('paging walks only the entries that resolved to an icon', () => {
    const groups: Record<string, string[]> = { 'Alpha glyphs': ['IconSized', 'IconMissing'] };

    renderIconGallery({ container, iconGroups: groups, icons: ALL_ICONS });

    openCell(container, 0);

    simulateKeydown(document, 'ArrowRight');

    const name = must(lightbox().querySelector<HTMLElement>('.icon-lightbox__name'), 'the lightbox name');

    expect(name.textContent).toBe('IconSized');
  });

  test('the gallery controls head the container and start on the native size', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    const controls = must(container.firstElementChild, 'the gallery controls');

    expect(controls.className).toBe('icon-gallery-controls');
    expect(controls).toBe(container.querySelector('.icon-gallery-controls'));
    expect(controls.getAttribute('role')).toBe('group');
    expect(controls.getAttribute('aria-label')).toBe('Icon preview size');

    const caption = must(controls.querySelector('span'), 'the controls caption');

    expect(caption.textContent).toBe('Blok Line · preview size');

    const labels = sizeButtons().map((button) => button.textContent);

    expect(labels).toStrictEqual(['Native', '16 px', '20 px', '24 px']);
    expect(sizeButtons().map((button) => button.type)).toStrictEqual(['button', 'button', 'button', 'button']);
    expect(sizeButtons().map((button) => button.className)).toStrictEqual([
      'icon-lightbox__btn',
      'icon-lightbox__btn',
      'icon-lightbox__btn',
      'icon-lightbox__btn',
    ]);
    expect(pressedStates()).toStrictEqual(['true', 'false', 'false', 'false']);
  });

  test('the size buttons resize every preview and move the pressed state', () => {
    renderIconGallery({ container, iconGroups: ALL_GROUPS, icons: ALL_ICONS });

    const sizes = (): string[] => Array.from(container.querySelectorAll('svg'))
      .map((svg) => `${svg.getAttribute('width')}x${svg.getAttribute('height')}`);

    sizeButtons()[1].click();

    expect(sizes()).toStrictEqual(['16x16', '16x16', '16x16', '16x16']);
    expect(pressedStates()).toStrictEqual(['false', 'true', 'false', 'false']);

    // "Native" restores each preview's own dimensions, not a fixed size.
    sizeButtons()[0].click();

    expect(sizes()).toStrictEqual(['32x32', '20x20', '48x20', '20x64']);
    expect(pressedStates()).toStrictEqual(['true', 'false', 'false', 'false']);
  });
});
