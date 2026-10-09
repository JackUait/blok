import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { openDatabaseConfirm } from '../../../../src/tools/database/database-confirm-dialog';

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-confirm-dialog]');
const action = (name: 'confirm' | 'cancel'): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-blok-database-confirm-action="${name}"]`);

const open = (): Promise<boolean> => openDatabaseConfirm({
  title: 'Would you like to remove sorting?',
  confirmLabel: 'Remove',
  cancelLabel: 'Don\'t remove',
});

describe('openDatabaseConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the question with the confirm button above the cancel button', () => {
    void open();

    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Would you like to remove sorting?');
    expect(action('confirm')?.textContent).toBe('Remove');
    expect(action('cancel')?.textContent).toBe('Don\'t remove');
    expect(action('confirm')?.compareDocumentPosition(action('cancel') ?? document.body))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('names the dialog by its title for assistive tech', () => {
    void open();

    const title = document.querySelector('[data-blok-database-confirm-title]');

    expect(title?.id).not.toBe('');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe(title?.id);
  });

  it('resolves true and closes when the user confirms', async () => {
    const answer = open();

    action('confirm')?.click();

    await expect(answer).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it('resolves false and closes when the user cancels', async () => {
    const answer = open();

    action('cancel')?.click();

    await expect(answer).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it('resolves false on Escape and keeps the key from reaching listeners below it', async () => {
    const below = vi.fn();

    document.addEventListener('keydown', below);

    const answer = open();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect(answer).resolves.toBe(false);
    expect(below).not.toHaveBeenCalled();
    document.removeEventListener('keydown', below);
  });

  it('marks the confirm button destructive when asked', () => {
    void openDatabaseConfirm({ title: 'Delete?', confirmLabel: 'Delete', cancelLabel: 'Cancel', destructive: true });

    expect(action('confirm')?.hasAttribute('data-destructive')).toBe(true);
  });
});
