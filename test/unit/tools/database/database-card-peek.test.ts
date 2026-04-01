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
});
