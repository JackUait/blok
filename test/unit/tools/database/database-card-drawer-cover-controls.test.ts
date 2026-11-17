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
    ...overrides,
  };
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
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

  it('groups "Change" and a Download icon button on the cover', () => {
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(ROW);

    const buttons = Array.from(group()?.querySelectorAll('button') ?? []);

    expect(group()?.getAttribute('role')).toBe('group');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].hasAttribute('data-blok-database-drawer-change-cover')).toBe(true);
    expect(buttons[0].textContent).toBe('Change');
    expect(buttons[0].getAttribute('aria-label')).toBe('Change the page cover');
    expect(buttons[1].hasAttribute('data-blok-database-drawer-download-cover')).toBe(true);
    expect(buttons[1].getAttribute('aria-label')).toBe('Download the cover image');
    expect(buttons[1].querySelector('svg')).not.toBeNull();
    expect(buttons[1].textContent?.trim()).toBe('');
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
  it('shows a "Download" hint above Download on hover, after the hint delay', () => {
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
});
