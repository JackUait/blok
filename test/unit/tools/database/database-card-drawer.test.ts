import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { KanbanCardData } from '../../../../src/tools/database/types';

const makeCard = (overrides: Partial<KanbanCardData> = {}): KanbanCardData => ({
  id: 'card-1',
  columnId: 'col-1',
  position: 'a0',
  title: 'Test card',
  ...overrides,
});

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  onTitleChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('DatabaseCardDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a drawer element ([data-blok-database-drawer]) when opened', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const el = options.wrapper.querySelector('[data-blok-database-drawer]');

    expect(el).not.toBeNull();
    expect(drawer.isOpen).toBe(true);
  });

  it('removes drawer element when closed', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();

    drawer.close();

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    expect(drawer.isOpen).toBe(false);
  });

  it('calls onTitleChange(cardId, newTitle) when title input fires input event', () => {
    const onTitleChange = vi.fn();
    const options = createOptions({ onTitleChange });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard({ id: 'card-42', title: 'Original title' });

    drawer.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();

    titleInput.value = 'Updated title';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onTitleChange).toHaveBeenCalledWith('card-42', 'Updated title');
  });

  it('calls onClose when close button ([data-blok-database-drawer-close]) is clicked', () => {
    const onClose = vi.fn();
    const options = createOptions({ onClose });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

    expect(closeBtn).not.toBeNull();

    closeBtn.click();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables title input (readOnly = true) in read-only mode', () => {
    const options = createOptions({ readOnly: true });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();
    expect(titleInput.readOnly).toBe(true);
  });

  describe('layout', () => {
    it('drawer is NOT absolutely positioned', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.position).not.toBe('absolute');
    });

    it('drawer has flex-shrink 0 to maintain width', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.flexShrink).toBe('0');
    });

    it('drawer has initial width of 0 for animation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.width).toBe('0px');
    });
  });

  describe('accessibility', () => {
    it('drawer has role="complementary" and aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.getAttribute('role')).toBe('complementary');
      expect(el.getAttribute('aria-label')).toBeTruthy();
    });

    it('close button has aria-label="Close"', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    });

    it('title input has aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(titleInput.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('styling', () => {
    it('drawer has a border-left for visual separation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.borderLeft).toBeTruthy();
    });

    it('drawer has a background color', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.backgroundColor).toBeTruthy();
    });

    it('title input has styling for font size and padding', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLElement;

      expect(titleInput.style.fontSize).toBeTruthy();
      expect(titleInput.style.padding).toBeTruthy();
    });

    it('close button has no default border or background', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.style.background).toBe('none');
      expect(closeBtn.style.borderStyle).toBe('none');
      expect(closeBtn.style.cursor).toBe('pointer');
    });

    it('close button displays the x character', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.textContent).toBe('\u00d7');
    });

    it('editor holder has padding', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const editorHolder = options.wrapper.querySelector('[data-blok-database-drawer-editor]') as HTMLElement;

      expect(editorHolder.style.padding).toBeTruthy();
    });
  });

  describe('close notification consistency', () => {
    it('calls onClose callback when close() is called directly', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      onClose.mockClear();

      drawer.close();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose callback when open() is called while already open', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card1 = makeCard({ id: 'card-1' });
      const card2 = makeCard({ id: 'card-2' });

      drawer.open(card1);
      onClose.mockClear();

      drawer.open(card2);

      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
