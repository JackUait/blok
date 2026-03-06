/**
 * Regression tests for toggle/header bugs 5, 6, 9, 10.
 * Tests are written FIRST (TDD) — they must fail before fixes are applied.
 */

import { describe, expect, it, vi } from 'vitest';
import type { API, BlockAPI } from '@/types';
import type { BlockToolConstructorOptions } from '@/types/tools/block-tool';
import { ToggleItem } from '../../../../src/tools/toggle/index';
import type { ToggleItemData, ToggleItemConfig } from '../../../../src/tools/toggle/types';
import { Header } from '../../../../src/tools/header/index';
import type { HeaderData, HeaderConfig } from '../../../../src/tools/header/index';
import { buildArrow } from '../../../../src/tools/toggle/dom-builder';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const makeI18n = () => ({
  t: vi.fn((key: string) => key),
  has: vi.fn(() => false),
});

const makeEvents = () => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
});

type BlocksStub = {
  getChildren: ReturnType<typeof vi.fn>;
  getBlockIndex: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  setBlockParent: ReturnType<typeof vi.fn>;
};

const makeBlocks = (children: unknown[] = []): BlocksStub => ({
  getChildren: vi.fn(() => children),
  getBlockIndex: vi.fn(() => 0),
  insert: vi.fn(() => ({ id: 'new-block' })),
  setBlockParent: vi.fn(),
});

const makeApi = (blocks: BlocksStub = makeBlocks()): API =>
  ({
    i18n: makeI18n(),
    events: makeEvents(),
    blocks,
    styles: { block: 'ce-block' },
  } as unknown as API);

const makeBlock = (id = 'toggle-1'): BlockAPI => ({ id } as unknown as BlockAPI);

// ---------------------------------------------------------------------------
// ToggleItem factory
// ---------------------------------------------------------------------------

const createToggle = (
  data: Partial<ToggleItemData> = {},
  opts: { readOnly?: boolean; blockId?: string; children?: unknown[] } = {}
): { toggle: ToggleItem; api: API; blocks: BlocksStub } => {
  const children = opts.children ?? [];
  const blocks = makeBlocks(children);
  const api = makeApi(blocks);
  const blockId = opts.blockId ?? 'toggle-1';

  const toggle = new ToggleItem({
    data: { text: '', ...data },
    config: {} as ToggleItemConfig,
    api,
    readOnly: opts.readOnly ?? false,
    block: makeBlock(blockId),
  } as BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig>);

  return { toggle, api, blocks };
};

// ---------------------------------------------------------------------------
// Header factory
// ---------------------------------------------------------------------------

const createHeader = (
  data: Partial<HeaderData> = {},
  opts: { readOnly?: boolean; blockId?: string; children?: unknown[] } = {}
): { header: Header; api: API; blocks: BlocksStub } => {
  const children = opts.children ?? [];
  const blocks = makeBlocks(children);
  const api = makeApi(blocks);
  const blockId = opts.blockId ?? 'header-1';

  const header = new Header({
    data: { text: '', level: 2, ...data },
    config: {} as HeaderConfig,
    api,
    readOnly: opts.readOnly ?? false,
    block: makeBlock(blockId),
  } as BlockToolConstructorOptions<HeaderData, HeaderConfig>);

  return { header, api, blocks };
};

// ---------------------------------------------------------------------------
// BUG 10: Arrow clickable in read-only mode
// ---------------------------------------------------------------------------

describe('Bug 10: Toggle arrow click guard in read-only mode', () => {
  it('buildArrow registers click listener when callback is provided', () => {
    const callback = vi.fn();
    const arrow = buildArrow(true, callback);

    arrow.click();

    // Verify the callback was invoked — proves click listener is attached
    expect(callback).toHaveBeenCalledTimes(1);
    // Verify the arrow is a real DOM element with the expected role
    expect(arrow.getAttribute('role')).toBe('button');
  });

  it('toggle render does not toggle open state on arrow click in read-only mode', () => {
    const { toggle } = createToggle({}, { readOnly: true });
    const element = toggle.render();

    const arrow = element.querySelector('[data-blok-toggle-arrow]') as HTMLElement;
    expect(arrow).not.toBeNull();

    // In read-only mode the toggle starts closed (!readOnly = false).
    // After arrow click, the attribute must remain unchanged.
    const attrBefore = element.getAttribute('data-blok-toggle-open');
    arrow.click();
    const attrAfter = element.getAttribute('data-blok-toggle-open');

    expect(attrAfter).toBe(attrBefore);
  });

  it('header buildArrow does not toggle when read-only', () => {
    const { header } = createHeader(
      { text: 'Title', level: 2, isToggleable: true },
      { readOnly: true }
    );
    const element = header.render();

    const arrow = element.querySelector('[data-blok-toggle-arrow]') as HTMLElement;
    expect(arrow).not.toBeNull();

    const attrBefore = element.getAttribute('data-blok-toggle-open');
    arrow.click();
    const attrAfter = element.getAttribute('data-blok-toggle-open');

    expect(attrAfter).toBe(attrBefore);
  });
});

// ---------------------------------------------------------------------------
// BUG 9: Body placeholder does not reappear after last child is deleted
// ---------------------------------------------------------------------------

describe('Bug 9: Body placeholder reappears after last child block is deleted', () => {
  it('placeholder becomes visible when block-changed(block-removed) fires and toggle has no children', () => {
    // Setup: toggle starts with one child so placeholder is hidden.
    const childHolder = document.createElement('div');
    const child = { id: 'child-1', holder: childHolder };
    const blocks = makeBlocks([child]);
    const api = makeApi(blocks);

    const toggle = new ToggleItem({
      data: { text: '' },
      config: {} as ToggleItemConfig,
      api,
      readOnly: false,
      block: makeBlock('toggle-1'),
    } as BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig>);

    const element = toggle.render();
    toggle.rendered();

    const placeholder = element.querySelector('[data-blok-toggle-body-placeholder]') as HTMLElement;
    expect(placeholder).not.toBeNull();

    // Placeholder should be hidden while child exists
    expect(placeholder.classList.contains('hidden')).toBe(true);

    // Simulate child removal: update blocks stub to return no children
    blocks.getChildren.mockReturnValue([]);

    // Retrieve the 'block changed' event handler registered on api.events.on
    const eventsOn = api.events.on as ReturnType<typeof vi.fn>;
    const registeredCalls = eventsOn.mock.calls as [string, (data: unknown) => void][];

    // There should be a registration for 'block changed'
    const blockChangedCall = registeredCalls.find(call => call[0] === 'block changed');
    expect(blockChangedCall).toBeDefined();

    const handler = blockChangedCall?.[1];
    expect(handler).toBeDefined();

    // Fire the event as if a child block was removed
    handler?.({ event: { type: 'block-removed' } });

    // Now placeholder must be visible
    expect(placeholder.classList.contains('hidden')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUG 6: Constructor overwrites _isOpen ignoring saved data.isOpen
// ---------------------------------------------------------------------------

describe('Bug 6: Saved isOpen state respected in constructor', () => {
  describe('ToggleItem', () => {
    it('uses data.isOpen=true even when readOnly=true', () => {
      // readOnly=true would set _isOpen = !readOnly = false, but data.isOpen=true should win
      const { toggle } = createToggle({ isOpen: true }, { readOnly: true });
      const element = toggle.render();

      expect(element.getAttribute('data-blok-toggle-open')).toBe('true');
    });

    it('uses data.isOpen=false even when readOnly=false (edit mode)', () => {
      // readOnly=false would set _isOpen = !readOnly = true, but data.isOpen=false should win
      const { toggle } = createToggle({ isOpen: false }, { readOnly: false });
      const element = toggle.render();

      expect(element.getAttribute('data-blok-toggle-open')).toBe('false');
    });

    it('falls back to !readOnly when data.isOpen is undefined (no saved state)', () => {
      const { toggle: toggleEdit } = createToggle({ text: '' }, { readOnly: false });
      const elEdit = toggleEdit.render();
      expect(elEdit.getAttribute('data-blok-toggle-open')).toBe('true');

      const { toggle: toggleRO } = createToggle({ text: '' }, { readOnly: true });
      const elRO = toggleRO.render();
      expect(elRO.getAttribute('data-blok-toggle-open')).toBe('false');
    });
  });

  describe('Header (toggleable)', () => {
    it('uses data.isOpen=true even when readOnly=true', () => {
      const { header } = createHeader(
        { text: 'H', level: 2, isToggleable: true, isOpen: true },
        { readOnly: true }
      );
      // render() returns wrapper div; data-blok-toggle-open is on the heading inside it
      const wrapper = header.render();
      const heading = wrapper.querySelector('[data-blok-toggle-open]');

      expect(heading?.getAttribute('data-blok-toggle-open')).toBe('true');
    });

    it('uses data.isOpen=false even when readOnly=false', () => {
      const { header } = createHeader(
        { text: 'H', level: 2, isToggleable: true, isOpen: false },
        { readOnly: false }
      );
      const wrapper = header.render();
      const heading = wrapper.querySelector('[data-blok-toggle-open]');

      expect(heading?.getAttribute('data-blok-toggle-open')).toBe('false');
    });

    it('falls back to !readOnly when data.isOpen is undefined', () => {
      const { header: hEdit } = createHeader(
        { text: 'H', level: 2, isToggleable: true },
        { readOnly: false }
      );
      const wEdit = hEdit.render();
      expect(wEdit.querySelector('[data-blok-toggle-open]')?.getAttribute('data-blok-toggle-open')).toBe('true');

      const { header: hRO } = createHeader(
        { text: 'H', level: 2, isToggleable: true },
        { readOnly: true }
      );
      const wRO = hRO.render();
      expect(wRO.querySelector('[data-blok-toggle-open]')?.getAttribute('data-blok-toggle-open')).toBe('false');
    });
  });
});

// ---------------------------------------------------------------------------
// BUG: onPaste() assigns unsanitized innerHTML — XSS via pasted DETAILS element
// ---------------------------------------------------------------------------

describe('Bug: onPaste() sanitizes pasted HTML before assigning to contentEl and _data', () => {
  it('strips onerror attribute from img tag inside pasted summary', () => {
    const { toggle } = createToggle();
    const element = toggle.render();

    // Build a <details> element with a <summary> containing a malicious img tag
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.innerHTML = '<img src="x" onerror="evil()">';
    details.appendChild(summary);

    const pasteEvent = {
      detail: { data: details },
    } as unknown as import('@/types').PasteEvent;

    toggle.onPaste(pasteEvent);

    const contentEl = element.querySelector('[data-blok-toggle-content]') as HTMLElement;
    expect(contentEl).not.toBeNull();
    expect(contentEl.innerHTML).not.toContain('onerror');
    expect(contentEl.innerHTML).not.toContain('evil');
  });

  it('strips onerror attribute from img tag inside pasted details (no summary)', () => {
    const { toggle } = createToggle();
    const element = toggle.render();

    // Build a <details> element without <summary>, content directly inside
    const details = document.createElement('details');
    details.innerHTML = '<img src="x" onerror="evil()">';

    const pasteEvent = {
      detail: { data: details },
    } as unknown as import('@/types').PasteEvent;

    toggle.onPaste(pasteEvent);

    const contentEl = element.querySelector('[data-blok-toggle-content]') as HTMLElement;
    expect(contentEl).not.toBeNull();
    expect(contentEl.innerHTML).not.toContain('onerror');
    expect(contentEl.innerHTML).not.toContain('evil');
  });

  it('preserves allowed tags (b, i, a) after sanitization', () => {
    const { toggle } = createToggle();
    const element = toggle.render();

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.innerHTML = '<b>bold</b> and <i>italic</i> and <a href="https://example.com">link</a>';
    details.appendChild(summary);

    const pasteEvent = {
      detail: { data: details },
    } as unknown as import('@/types').PasteEvent;

    toggle.onPaste(pasteEvent);

    const contentEl = element.querySelector('[data-blok-toggle-content]') as HTMLElement;
    expect(contentEl).not.toBeNull();
    expect(contentEl.innerHTML).toContain('<b>bold</b>');
    expect(contentEl.innerHTML).toContain('<i>italic</i>');
    expect(contentEl.innerHTML).toContain('<a');
  });
});

// ---------------------------------------------------------------------------
// BUG 5: isOpen not persisted in save data
// ---------------------------------------------------------------------------

describe('Bug 5: Toggle collapsed state persisted in save()', () => {
  describe('ToggleItem.save()', () => {
    it('includes isOpen=true when toggle is open', () => {
      const { toggle } = createToggle({ text: 'hello', isOpen: true }, { readOnly: false });
      toggle.render();
      const saved = toggle.save();

      expect(saved.isOpen).toBe(true);
    });

    it('includes isOpen reflecting current state after collapse', () => {
      // Start open, then collapse by toggling internal state
      const { toggle } = createToggle({ text: 'world', isOpen: true }, { readOnly: false });
      toggle.render();

      // Collapse the toggle
      toggle.collapse();

      const saved = toggle.save();
      expect(saved.isOpen).toBe(false);
    });

    it('saves current state when no explicit isOpen was provided in data', () => {
      // When no isOpen in data, _isOpen = data.isOpen ?? !readOnly = undefined ?? true = true
      const { toggle } = createToggle({ text: '' }, { readOnly: false });
      toggle.render();
      const saved = toggle.save();

      expect(saved.isOpen).toBe(true);
    });
  });

  describe('Header.save()', () => {
    it('includes isOpen=true in saved data when toggle heading is open', () => {
      const { header } = createHeader(
        { text: 'Title', level: 2, isToggleable: true, isOpen: true },
        { readOnly: false }
      );
      const element = header.render();
      const saved = header.save(element);

      expect(saved.isOpen).toBe(true);
    });

    it('includes isOpen=false in saved data when toggle heading is closed', () => {
      const { header } = createHeader(
        { text: 'Title', level: 2, isToggleable: true, isOpen: false },
        { readOnly: false }
      );
      const element = header.render();
      const saved = header.save(element);

      expect(saved.isOpen).toBe(false);
    });

    it('does not include isOpen for non-toggleable headers', () => {
      const { header } = createHeader(
        { text: 'Title', level: 2 },
        { readOnly: false }
      );
      const element = header.render();
      const saved = header.save(element);

      expect(saved.isOpen).toBeUndefined();
    });
  });
});
