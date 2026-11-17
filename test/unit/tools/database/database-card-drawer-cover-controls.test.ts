import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';
import { downloadImage } from '../../../../src/tools/image/download';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';

vi.mock('../../../../src/blok', () => ({
  Blok: vi.fn(function stubBlok() {
    return {
      isReady: Promise.resolve(),
      save: vi.fn().mockResolvedValue({ blocks: [] }),
      destroy: vi.fn(),
    };
  }),
}));

vi.mock('../../../../src/tools/image/download', () => ({
  downloadImage: vi.fn().mockResolvedValue(undefined),
}));

/**
 * notion-motion.md Round 59 §1 (and Round 15 "Cover hover"): the cover holds one
 * button group, "Change" then a "Download the cover image" icon button.
 */

const COVER = 'https://example.com/cover.png';
const SCHEMA: PropertyDefinition[] = [{ id: 'p-title', name: 'Title', type: 'title', position: 'a0' }];
const ROW: DatabaseRow = { id: 'row-1', position: 'a0', properties: { 'p-title': 'Card' }, cover: COVER };

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  return {
    wrapper,
    readOnly: false,
    titlePropertyId: 'p-title',
    schema: SCHEMA,
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    onIconChange: vi.fn(),
    onCoverChange: vi.fn(),
    onCoverPositionChange: vi.fn(),
    ...overrides,
  };
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const img = (): HTMLImageElement | null => q<HTMLImageElement>('[data-blok-database-drawer-cover] > img');
const group = (): HTMLElement | null => q('[data-blok-database-drawer-cover] > [data-blok-database-drawer-cover-controls]');

describe('row page cover controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('groups "Change", "Reposition" and a Download icon button on the cover', () => {
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);

    const buttons = Array.from(group()?.querySelectorAll('button') ?? []);

    expect(group()?.getAttribute('role')).toBe('group');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].hasAttribute('data-blok-database-drawer-change-cover')).toBe(true);
    expect(buttons[0].textContent).toBe('Change');
    expect(buttons[0].getAttribute('aria-label')).toBe('Change the page cover');
    expect(buttons[1].hasAttribute('data-blok-database-drawer-reposition-cover')).toBe(true);
    expect(buttons[1].textContent).toBe('Reposition');
    expect(buttons[1].getAttribute('aria-label')).toBe('Reposition the cover image');
    expect(buttons[2].hasAttribute('data-blok-database-drawer-download-cover')).toBe(true);
    expect(buttons[2].getAttribute('aria-label')).toBe('Download the cover image');
    expect(buttons[2].querySelector('svg')).not.toBeNull();
    expect(buttons[2].textContent?.trim()).toBe('');
    drawer.destroy();
  });

  it('downloads the cover image from Download', () => {
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);
    q<HTMLButtonElement>('[data-blok-database-drawer-download-cover]')?.click();

    expect(downloadImage).toHaveBeenCalledTimes(1);
    expect(downloadImage).toHaveBeenCalledWith(COVER);
    drawer.destroy();
  });

  it('opens the cover picker from Change', () => {
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);
    q<HTMLButtonElement>('[data-blok-database-drawer-change-cover]')?.click();

    expect(q('[data-role="audio-cover-picker"]')).not.toBeNull();
    drawer.destroy();
  });

  // notion-motion.md Round 60 §1: hovering Download shows a "Download" hint above it. The delay is the 500ms hint law.
  it('shows a "Download" hint 6px above Download on hover, after the hint delay', () => {
    destroyTooltip();
    vi.useFakeTimers();
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);
    const download = q<HTMLButtonElement>('[data-blok-database-drawer-download-cover]');

    if (download === null) throw new Error('no Download button');
    vi.spyOn(download, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 1436, y: 56, width: 24, height: 24 }));
    download.dispatchEvent(new MouseEvent('mouseenter'));
    const hint = (): HTMLElement | null => q('[data-blok-testid="tooltip"]');

    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(hint()?.getAttribute('data-blok-shown')).not.toBe('true');
    vi.advanceTimersByTime(1);
    expect(hint()?.getAttribute('data-blok-shown')).toBe('true');
    expect(q('[data-blok-testid="tooltip-content"]')?.textContent).toBe('Download');
    expect(hint()?.getAttribute('data-blok-placement')).toBe('top');
    // jsdom gives the hint no height: its top is the button's top (56) less Notion's 6px gap.
    expect(hint()?.style.top).toBe('50px');
    drawer.destroy();
    destroyTooltip();
    vi.useRealTimers();
  });

  it('gives a read-only viewer no group', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ readOnly: true }));

    drawer.open(ROW);

    expect(q('[data-blok-database-drawer-cover]')).not.toBeNull();
    expect(group()).toBeNull();
    drawer.destroy();
  });

  it('paints a saved cover position, read-only too', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ readOnly: true }));

    drawer.open({ ...ROW, coverPosition: 30 });

    expect(img()?.style.objectPosition).toBe('50% 30%');
    drawer.destroy();
  });

  it('leaves a cover with no saved position at the stylesheet default', () => {
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);

    expect(img()?.style.objectPosition).toBe('');
    drawer.destroy();
  });
});

/**
 * notion-motion.md Round 60 §1: Reposition swaps the group to "Save position" and "Cancel",
 * shows a "Drag image to reposition" pill, and a drag moves the image vertically by
 * Δy ÷ the displayed image height, clamped 0–100 %.
 */
describe('row page cover reposition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /** Notion's read: a 1500×1189 image in a 756×143.4 cover shows 599.3 tall. */
  const sizeCover = (): void => {
    const image = img();
    const cover = q('[data-blok-database-drawer-cover]');

    if (image === null || cover === null) throw new Error('no cover');
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1500 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1189 });
    vi.spyOn(cover, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 756, height: 143.4 }));
  };

  const drag = (dx: number, dy: number): void => {
    const cover = q('[data-blok-database-drawer-cover]');

    cover?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100, pointerId: 1 }));
    cover?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 }));
    cover?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 }));
  };

  const startRepositioning = (options: Partial<CardDrawerOptions> = {}, row: DatabaseRow = ROW): { drawer: DatabaseCardDrawer; opts: CardDrawerOptions } => {
    const opts = createOptions(options);
    const drawer = new DatabaseCardDrawer(opts);

    drawer.open(row);
    sizeCover();
    q<HTMLButtonElement>('[data-blok-database-drawer-reposition-cover]')?.click();

    return { drawer, opts };
  };

  it('swaps the group to Save position and Cancel and shows the drag pill', () => {
    const { drawer } = startRepositioning({ onCoverPositionChange: vi.fn() });
    const buttons = Array.from(group()?.querySelectorAll('button') ?? []);

    expect(buttons.map((button) => button.textContent)).toEqual(['Save position', 'Cancel']);
    expect(q('[data-blok-database-drawer-cover]')?.hasAttribute('data-blok-database-drawer-cover-repositioning')).toBe(true);
    expect(q('[data-blok-database-drawer-cover] > [data-blok-database-drawer-cover-hint]')?.textContent).toBe('Drag image to reposition');
    drawer.destroy();
  });

  it('moves the image by the drag over the displayed image height, vertically only', () => {
    const onCoverPositionChange = vi.fn();
    const { drawer } = startRepositioning({ onCoverPositionChange });

    drag(80, 130);

    expect(img()?.style.objectPosition).toBe('50% 28.31%');
    expect(onCoverPositionChange).not.toHaveBeenCalled();
    drawer.destroy();
  });

  it('clamps the position to 0 and 100 %', () => {
    const { drawer } = startRepositioning({ onCoverPositionChange: vi.fn() });

    drag(0, -2000);
    expect(img()?.style.objectPosition).toBe('50% 100%');
    drag(0, 4000);
    expect(img()?.style.objectPosition).toBe('50% 0%');
    drawer.destroy();
  });

  it('saves the dragged position once and leaves the mode', () => {
    const onCoverPositionChange = vi.fn();
    const { drawer } = startRepositioning({ onCoverPositionChange });

    drag(0, 130);
    q<HTMLButtonElement>('[data-blok-database-drawer-save-cover-position]')?.click();

    expect(onCoverPositionChange).toHaveBeenCalledTimes(1);
    expect(onCoverPositionChange).toHaveBeenCalledWith('row-1', 28.31);
    expect(q('[data-blok-database-drawer-cover]')?.hasAttribute('data-blok-database-drawer-cover-repositioning')).toBe(false);
    expect(q('[data-blok-database-drawer-cover-hint]')?.style.opacity).toBe('0');
    expect(q('[data-blok-database-drawer-reposition-cover]')).not.toBeNull();
    drawer.destroy();
  });

  it('writes nothing when Save follows no drag', () => {
    const onCoverPositionChange = vi.fn();
    const { drawer } = startRepositioning({ onCoverPositionChange });

    q<HTMLButtonElement>('[data-blok-database-drawer-save-cover-position]')?.click();

    expect(onCoverPositionChange).not.toHaveBeenCalled();
    drawer.destroy();
  });

  it('snaps back on Cancel', () => {
    const onCoverPositionChange = vi.fn();
    const { drawer } = startRepositioning({ onCoverPositionChange }, { ...ROW, coverPosition: 20 });

    drag(0, 130);
    q<HTMLButtonElement>('[data-blok-database-drawer-cancel-cover-position]')?.click();

    expect(img()?.style.objectPosition).toBe('50% 20%');
    expect(onCoverPositionChange).not.toHaveBeenCalled();
    expect(q('[data-blok-database-drawer-reposition-cover]')).not.toBeNull();
    drawer.destroy();
  });

  it('cancels on Escape and keeps the page open', () => {
    const onCoverPositionChange = vi.fn();
    const { drawer, opts } = startRepositioning({ onCoverPositionChange });

    drag(0, 130);
    q('[data-blok-database-drawer-cover]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(img()?.style.objectPosition).toBe('');
    expect(onCoverPositionChange).not.toHaveBeenCalled();
    expect(opts.onClose).not.toHaveBeenCalled();
    expect(q('[data-blok-database-drawer-cover-hint]')?.style.opacity).toBe('0');
    drawer.destroy();
  });

  it('fades the pill out before it goes on Cancel', () => {
    vi.useFakeTimers();
    const { drawer } = startRepositioning();

    q<HTMLButtonElement>('[data-blok-database-drawer-cancel-cover-position]')?.click();
    const pill = q('[data-blok-database-drawer-cover-hint]');

    expect(pill?.style.opacity).toBe('0');
    vi.advanceTimersByTime(300);
    expect(q('[data-blok-database-drawer-cover-hint]')).toBeNull();
    vi.useRealTimers();
    drawer.destroy();
  });

  it('leaves no Reposition behind a closed page to swallow the next Escape', () => {
    const { drawer } = startRepositioning();

    drawer.close();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    document.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(false);
    drawer.destroy();
  });

  it('has no Reposition without a position writer', () => {
    const drawer = new DatabaseCardDrawer(createOptions({ onCoverPositionChange: undefined }));

    drawer.open(ROW);

    expect(q('[data-blok-database-drawer-reposition-cover]')).toBeNull();
    drawer.destroy();
  });
});
