import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardPeek } from '../../../../src/tools/database/database-card-peek';
import type { CardPeekOptions } from '../../../../src/tools/database/database-card-peek';
import type { KanbanCardData } from '../../../../src/tools/database/types';

const makeCard = (overrides: Partial<KanbanCardData> = {}): KanbanCardData => ({
  id: 'card-1',
  columnId: 'col-1',
  position: 'a0',
  title: 'Test card',
  ...overrides,
});

const createOptions = (overrides: Partial<CardPeekOptions> = {}): CardPeekOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  onTitleChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('DatabaseCardPeek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a panel element ([data-blok-database-peek]) when opened', () => {
    const options = createOptions();
    const peek = new DatabaseCardPeek(options);
    const card = makeCard();

    peek.open(card);

    const panel = options.wrapper.querySelector('[data-blok-database-peek]');

    expect(panel).not.toBeNull();
    expect(peek.isOpen).toBe(true);
  });

  it('removes panel element when closed', () => {
    const options = createOptions();
    const peek = new DatabaseCardPeek(options);
    const card = makeCard();

    peek.open(card);

    expect(options.wrapper.querySelector('[data-blok-database-peek]')).not.toBeNull();

    peek.close();

    expect(options.wrapper.querySelector('[data-blok-database-peek]')).toBeNull();
    expect(peek.isOpen).toBe(false);
  });

  it('calls onTitleChange(cardId, newTitle) when title input fires input event', () => {
    const onTitleChange = vi.fn();
    const options = createOptions({ onTitleChange });
    const peek = new DatabaseCardPeek(options);
    const card = makeCard({ id: 'card-42', title: 'Original title' });

    peek.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-peek-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();

    titleInput.value = 'Updated title';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onTitleChange).toHaveBeenCalledWith('card-42', 'Updated title');
  });

  it('calls onClose when close button ([data-blok-database-peek-close]) is clicked', () => {
    const onClose = vi.fn();
    const options = createOptions({ onClose });
    const peek = new DatabaseCardPeek(options);
    const card = makeCard();

    peek.open(card);

    const closeBtn = options.wrapper.querySelector('[data-blok-database-peek-close]') as HTMLButtonElement;

    expect(closeBtn).not.toBeNull();

    closeBtn.click();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables title input (readOnly = true) in read-only mode', () => {
    const options = createOptions({ readOnly: true });
    const peek = new DatabaseCardPeek(options);
    const card = makeCard();

    peek.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-peek-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();
    expect(titleInput.readOnly).toBe(true);
  });

  describe('accessibility', () => {
    it('panel has role="complementary" and aria-label', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const panel = options.wrapper.querySelector('[data-blok-database-peek]') as HTMLElement;

      expect(panel.getAttribute('role')).toBe('complementary');
      expect(panel.getAttribute('aria-label')).toBeTruthy();
    });

    it('close button has aria-label="Close"', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-peek-close]') as HTMLButtonElement;

      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    });

    it('title input has aria-label', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-peek-title]') as HTMLInputElement;

      expect(titleInput.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('styling', () => {
    it('panel has a border-left for visual separation', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const panel = options.wrapper.querySelector('[data-blok-database-peek]') as HTMLElement;

      expect(panel.style.borderLeft).toBeTruthy();
    });

    it('panel has a background color', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const panel = options.wrapper.querySelector('[data-blok-database-peek]') as HTMLElement;

      expect(panel.style.backgroundColor).toBeTruthy();
    });

    it('panel has a box shadow', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const panel = options.wrapper.querySelector('[data-blok-database-peek]') as HTMLElement;

      expect(panel.style.boxShadow).toBeTruthy();
    });

    it('title input has styling for font size and padding', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-peek-title]') as HTMLElement;

      expect(titleInput.style.fontSize).toBeTruthy();
      expect(titleInput.style.padding).toBeTruthy();
    });

    it('close button has no default border or background', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-peek-close]') as HTMLElement;

      expect(closeBtn.style.background).toBe('none');
      expect(closeBtn.style.borderStyle).toBe('none');
      expect(closeBtn.style.cursor).toBe('pointer');
    });

    it('close button displays the x character', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-peek-close]') as HTMLElement;

      expect(closeBtn.textContent).toBe('\u00d7');
    });

    it('sets initial transform to translateX(100%) for slide-in animation', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const panel = options.wrapper.querySelector('[data-blok-database-peek]') as HTMLElement;

      expect(panel.style.transform).toBe('translateX(100%)');
    });

    it('editor holder has padding', () => {
      const options = createOptions();
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);

      const editorHolder = options.wrapper.querySelector('[data-blok-database-peek-editor]') as HTMLElement;

      expect(editorHolder.style.padding).toBeTruthy();
    });
  });

  describe('close notification consistency', () => {
    it('calls onClose callback when close() is called directly', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const peek = new DatabaseCardPeek(options);
      const card = makeCard();

      peek.open(card);
      onClose.mockClear();

      peek.close();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose callback when open() is called while already open', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const peek = new DatabaseCardPeek(options);
      const card1 = makeCard({ id: 'card-1' });
      const card2 = makeCard({ id: 'card-2' });

      peek.open(card1);
      onClose.mockClear();

      peek.open(card2);

      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
