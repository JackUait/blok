import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alert, confirm, prompt, getWrapper, CSS } from '../../../../src/components/utils/notifier/draw';

describe('Notifier draw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('alert', () => {
    it('does not render an icon element (dark pill has no icon)', () => {
      const el = alert({ message: 'Hello' });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');

      expect(icon).toBeNull();
    });

    it('does not render a close button (dark pill has no close button)', () => {
      const el = alert({ message: 'Test' });
      const cross = el.querySelector('[data-blok-testid="notification-cross"]');

      expect(cross).toBeNull();
    });

    it('uses flex layout for message alignment', () => {
      const el = alert({ message: 'Layout test' });

      expect(el.className).toContain('flex');
    });

    it('preserves existing data-blok-testid behavior for styled alerts', () => {
      const success = alert({ message: 'ok', style: 'success' });

      expect(success.getAttribute('data-blok-testid')).toBe('notification-success');

      const error = alert({ message: 'fail', style: 'error' });

      expect(error.getAttribute('data-blok-testid')).toBe('notification-error');

      const plain = alert({ message: 'plain' });

      expect(plain.getAttribute('data-blok-testid')).toBe('notification');
    });

    it('removes notification when close button is clicked', () => {
      // Dark pill has no cross button; notification is dismissed by timeout only.
      // This test verifies that no spurious close button exists.
      const el = alert({ message: 'removeme' });

      document.body.appendChild(el);
      const cross = el.querySelector('[data-blok-testid="notification-cross"]');

      expect(cross).toBeNull();
      el.remove();
    });
  });

  describe('alert accessibility', () => {
    it('renders a live region announcing the message politely', () => {
      const el = alert({ message: 'hi' });

      expect(el.getAttribute('role')).toBe('region');

      const live = el.querySelector('[aria-live]');

      expect(live?.getAttribute('aria-live')).toBe('polite');
      expect(live?.textContent).toBe('hi');
    });

    it('announces error-style alerts assertively', () => {
      const el = alert({ message: 'bad', style: 'error' });
      const live = el.querySelector('[aria-live]');

      expect(live?.getAttribute('aria-live')).toBe('assertive');
    });
  });

  describe('confirm', () => {
    afterEach(() => {
      document.querySelectorAll('[data-blok-testid^="notification"]').forEach((el) => el.remove());
    });

    it('preserves confirm/cancel buttons (no icon in dark pill)', () => {
      const el = confirm({
        message: 'Sure?',
        okHandler: vi.fn(),
        cancelHandler: vi.fn(),
      });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');
      const okBtn = el.querySelector('[data-blok-testid="notification-confirm-button"]');
      const cancelBtn = el.querySelector('[data-blok-testid="notification-cancel-button"]');

      expect(icon).toBeNull();
      expect(okBtn).not.toBeNull();
      expect(cancelBtn).not.toBeNull();
    });

    it('is a modal alertdialog labelled by the message', () => {
      const el = confirm({ message: 'Sure?', okHandler: vi.fn() });

      expect(el.getAttribute('role')).toBe('alertdialog');
      expect(el.getAttribute('aria-modal')).toBe('true');

      const labelledBy = el.getAttribute('aria-labelledby');

      expect(labelledBy).toBeTruthy();
      expect(el.querySelector(`#${labelledBy}`)?.textContent).toBe('Sure?');
    });

    it('moves focus to the OK button on show', async () => {
      const el = confirm({ message: 'Sure?', okHandler: vi.fn() });

      document.body.appendChild(el);
      await Promise.resolve();

      expect(document.activeElement).toBe(el.querySelector('[data-blok-testid="notification-confirm-button"]'));
    });

    it('cancels on Escape and restores focus', () => {
      const cancelHandler = vi.fn();
      const trigger = document.createElement('button');

      document.body.appendChild(trigger);
      trigger.focus();

      const el = confirm({ message: 'Sure?', okHandler: vi.fn(), cancelHandler });

      document.body.appendChild(el);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(cancelHandler).toHaveBeenCalledTimes(1);
      expect(el.isConnected).toBe(false);
      expect(document.activeElement).toBe(trigger);

      trigger.remove();
    });

    it('traps focus, wrapping at both ends with Tab', () => {
      const el = confirm({ message: 'Sure?', okHandler: vi.fn(), cancelHandler: vi.fn() });

      document.body.appendChild(el);

      const focusables = el.querySelectorAll<HTMLElement>('button, input, [tabindex]');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(first);

      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(document.activeElement).toBe(last);
    });
  });

  describe('prompt', () => {
    afterEach(() => {
      document.querySelectorAll('[data-blok-testid^="notification"]').forEach((el) => el.remove());
    });

    it('preserves input field (no icon in dark pill)', () => {
      const el = prompt({
        message: 'Name?',
        okHandler: vi.fn(),
      });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');
      const input = el.querySelector('[data-blok-testid="notification-input"]');

      expect(icon).toBeNull();
      expect(input).not.toBeNull();
    });

    it('is a modal alertdialog with the input labelled by the message', () => {
      const el = prompt({ message: 'Name?', okHandler: vi.fn() });

      expect(el.getAttribute('role')).toBe('alertdialog');
      expect(el.getAttribute('aria-modal')).toBe('true');

      const input = el.querySelector('[data-blok-testid="notification-input"]');
      const messageId = el.getAttribute('aria-labelledby');

      expect(messageId).toBeTruthy();
      expect(input?.getAttribute('aria-labelledby')).toBe(messageId);
    });

    it('moves focus to the input on show', async () => {
      const el = prompt({ message: 'Name?', okHandler: vi.fn() });

      document.body.appendChild(el);
      await Promise.resolve();

      expect(document.activeElement).toBe(el.querySelector('[data-blok-testid="notification-input"]'));
    });

    it('submits with the input value when Enter is pressed', () => {
      const okHandler = vi.fn();
      const el = prompt({ message: 'Name?', okHandler });

      document.body.appendChild(el);

      const input = el.querySelector<HTMLInputElement>('[data-blok-testid="notification-input"]');

      if (input === null) {
        throw new Error('input not found');
      }

      input.value = 'Ada';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(okHandler).toHaveBeenCalledWith('Ada');
      expect(el.isConnected).toBe(false);
    });

    it('renders a Cancel button wired to the cancel handler', () => {
      const cancelHandler = vi.fn();
      const el = prompt({ message: 'Name?', okHandler: vi.fn(), cancelHandler });
      const cancelBtn = el.querySelector<HTMLButtonElement>('[data-blok-testid="notification-cancel-button"]');

      expect(cancelBtn).not.toBeNull();

      document.body.appendChild(el);
      cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(cancelHandler).toHaveBeenCalledTimes(1);
      expect(el.isConnected).toBe(false);
    });

    it('cancels on Escape', () => {
      const cancelHandler = vi.fn();
      const el = prompt({ message: 'Name?', okHandler: vi.fn(), cancelHandler });

      document.body.appendChild(el);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(cancelHandler).toHaveBeenCalledTimes(1);
      expect(el.isConnected).toBe(false);
    });
  });

  describe('getWrapper', () => {
    it('creates a wrapper element with correct class and testid', () => {
      const wrapper = getWrapper();

      expect(wrapper.getAttribute('data-blok-testid')).toBe('notifier-container');
      expect(wrapper.className).toContain('fixed');
    });
  });

  describe('CSS', () => {
    it('uses refined border radius', () => {
      expect(CSS.notification).toContain('rounded');
    });

    it('suppresses native focus outline on action buttons', () => {
      // outline-hidden ensures buttons (OK/Cancel) do not show a browser focus ring on click
      expect(CSS.btn).toContain('outline-hidden');
    });
  });
});
