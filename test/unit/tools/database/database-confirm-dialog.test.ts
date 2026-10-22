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
    expect(action('confirm')?.hasAttribute('data-filled')).toBe(false);
  });

  // research/26 §5a, 23 §7, 10 §5: Delete view, Discard and Reset are filled red buttons.
  it('fills the confirm button when asked', () => {
    void openDatabaseConfirm({ title: 'Discard?', confirmLabel: 'Discard', cancelLabel: 'Cancel', destructive: true, filled: true });

    expect(action('confirm')?.hasAttribute('data-filled')).toBe(true);
    expect(action('cancel')?.hasAttribute('data-filled')).toBe(false);
  });

  // research/10 §5 and 26 §5a: Reset and Delete the last view read a 17px title; the rest read 16px.
  it('marks the title large only when asked', () => {
    void open();

    expect(dialog()?.hasAttribute('data-large-title')).toBe(false);
    document.body.innerHTML = '';
    void openDatabaseConfirm({ title: 'Reset?', confirmLabel: 'Reset', cancelLabel: 'Cancel', largeTitle: true });

    expect(dialog()?.hasAttribute('data-large-title')).toBe(true);
  });

  // research/10 §5: Reset's Cancel has no border or fill and grey ink.
  it('draws a quiet Cancel only when asked', () => {
    void openDatabaseConfirm({ title: 'Delete?', confirmLabel: 'Delete', cancelLabel: 'Cancel', destructive: true });

    expect(action('cancel')?.hasAttribute('data-quiet')).toBe(false);
    document.body.innerHTML = '';
    void openDatabaseConfirm({ title: 'Reset?', confirmLabel: 'Reset', cancelLabel: 'Cancel', destructive: true, quietCancel: true });

    expect(action('cancel')?.hasAttribute('data-quiet')).toBe(true);
    expect(action('confirm')?.hasAttribute('data-quiet')).toBe(false);
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

    // research/30 B3: Notion's dialog has a × at the top right, and it takes focus on open.
    describe('with a close label', () => {
      const closeButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-close]');
      const openClosable = (): Promise<number | null> => openDatabaseChoice({ title: 'Delete?', confirmLabel: 'Delete view', cancelLabel: 'Cancel', destructive: true, choices, closeLabel: 'Close' });

      it('focuses the × on open', () => {
        void openClosable();

        expect(closeButton()).toHaveFocus();
        expect(closeButton()?.getAttribute('aria-label')).toBe('Close');
        expect(closeButton()?.type).toBe('button');
        expect(dialog()?.contains(closeButton())).toBe(true);
      });

      it('resolves null and closes on a × click', async () => {
        const answer = openClosable();

        cards()[1].click();
        closeButton()?.click();

        await expect(answer).resolves.toBeNull();
        expect(dialog()).toBeNull();
      });
    });

    it('focuses the confirm button when asked', () => {
      void openDatabaseConfirm({ title: 'Undo?', confirmLabel: 'Remove', cancelLabel: 'Cancel', destructive: true, focusConfirm: true });

      expect(action('confirm')).toHaveFocus();
    });

    it('has no × and focuses Cancel without a close label', () => {
      void openChoice();

      expect(document.querySelector('[data-blok-database-confirm-close]')).toBeNull();
      expect(action('cancel')).toHaveFocus();
    });

    // CLAUDE.md "No blue selected states": a picked card has no fill and the same ink as the others.
    // The radio dot is exempt: its measured light centre (research/35 §1.7) is not a card fill.
    it('paints a picked card with no fill and the same ink as an unpicked one', () => {
      const css = readMainCss();
      const picked = [...css.matchAll(/\[data-blok-database-confirm-choice\]\[aria-checked="true"\]([^{]*)\{([^}]*)\}/g)]
        .filter((m) => !m[1].includes('[data-blok-database-confirm-choice-dot]'))
        .map((m) => m[2]);

      expect(picked.length).toBeGreaterThan(0);
      for (const body of picked) {
        expect(body).not.toMatch(/background|(^|[^-])color\s*:/);
      }
    });
  });
});
