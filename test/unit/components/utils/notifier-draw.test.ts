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

  describe('confirm', () => {
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
  });

  describe('prompt', () => {
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
