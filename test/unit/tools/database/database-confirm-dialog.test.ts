import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { openDatabaseChoice, openDatabaseConfirm } from '../../../../src/tools/database/database-confirm-dialog';
import { readMainCss } from '../../styles/helpers/read-main-css';

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

  // Mounted on body, outside the editor: without the popover scope it renders in the browser's serif font.
  it('mounts the dialog under a data-blok-popover root', () => {
    void open();

    expect(dialog()?.closest('[data-blok-popover]')).not.toBeNull();
  });

  it('names the dialog by its title for assistive tech', () => {
    void open();

    const title = document.querySelector('[data-blok-database-confirm-title]');

    expect(title?.id).not.toBe('');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe(title?.id);
  });

  it('shows a description under the title, as the dialog\'s description', () => {
    void openDatabaseConfirm({ title: 'Reset?', description: 'No properties will be deleted.', confirmLabel: 'Reset', cancelLabel: 'Cancel' });
    const description = document.querySelector('[data-blok-database-confirm-description]');

    expect(description?.textContent).toBe('No properties will be deleted.');
    expect(document.querySelector('[data-blok-database-confirm-title]')?.nextElementSibling).toBe(description);
    expect(description?.id).not.toBe('');
    expect(dialog()?.getAttribute('aria-describedby')).toBe(description?.id);
  });

  it('draws no description when none is given', () => {
    void open();

    expect(document.querySelector('[data-blok-database-confirm-description]')).toBeNull();
    expect(dialog()?.hasAttribute('aria-describedby')).toBe(false);
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

  // research/26 §5a: "Delete the last view for this data source?" with two radio cards.
  describe('radio cards', () => {
    const choices = [
      { label: 'Delete view only', description: 'Kept' },
      { label: 'Delete view and data source', description: 'Deleted' },
    ];
    const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-confirm-choice]')];
    const openChoice = (): Promise<number | null> => openDatabaseChoice({ title: 'Delete?', confirmLabel: 'Delete view', cancelLabel: 'Cancel', destructive: true, choices });

    it('draws the cards as a radio group between the title and the buttons, the first picked', () => {
      void openChoice();
      const group = document.querySelector('[role="radiogroup"]');

      expect(cards().map((card) => card.getAttribute('role'))).toEqual(['radio', 'radio']);
      expect(cards().map((card) => card.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(cards()[0].textContent).toContain('Delete view only');
      expect(cards()[0].textContent).toContain('Kept');
      expect(group?.compareDocumentPosition(action('confirm') ?? document.body)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('resolves the picked card\'s index on confirm', async () => {
      const answer = openChoice();

      cards()[1].click();
      expect(cards().map((card) => card.getAttribute('aria-checked'))).toEqual(['false', 'true']);
      action('confirm')?.click();

      await expect(answer).resolves.toBe(1);
    });

    it('resolves null on cancel', async () => {
      const answer = openChoice();

      cards()[1].click();
      action('cancel')?.click();

      await expect(answer).resolves.toBeNull();
    });

    // CLAUDE.md "No blue selected states": a picked card has no fill and the same ink as the others.
    it('paints a picked card with no fill and the same ink as an unpicked one', () => {
      const css = readMainCss();
      const picked = [...css.matchAll(/\[data-blok-database-confirm-choice\]\[aria-checked="true"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);

      expect(picked.length).toBeGreaterThan(0);
      for (const body of picked) {
        expect(body).not.toMatch(/background|(^|[^-])color\s*:/);
      }
    });
  });
});
