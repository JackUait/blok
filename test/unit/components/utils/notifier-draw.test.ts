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
    it('renders an icon element for default style', () => {
      const el = alert({ message: 'Hello' });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');

      expect(icon).not.toBeNull();
      expect(icon?.querySelector('svg')).not.toBeNull();
    });

    it('renders a success icon for success style', () => {
      const el = alert({ message: 'Done', style: 'success' });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');

      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('data-blok-style')).toBe('success');
    });

    it('renders an error icon for error style', () => {
      const el = alert({ message: 'Fail', style: 'error' });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');

      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('data-blok-style')).toBe('error');
    });

    it('renders a default icon when no style is provided', () => {
      const el = alert({ message: 'Info' });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');

      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('data-blok-style')).toBe('default');
    });

    it('renders close button with an SVG element', () => {
      const el = alert({ message: 'Test' });
      const cross = el.querySelector('[data-blok-testid="notification-cross"]');

      expect(cross).not.toBeNull();
      expect(cross?.querySelector('svg')).not.toBeNull();
    });

    it('uses flex layout for icon and message alignment', () => {
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

    it('removes notification when cross button is clicked', () => {
      const el = alert({ message: 'removeme' });

      document.body.appendChild(el);
      const cross = el.querySelector('[data-blok-testid="notification-cross"]') as HTMLElement;

      cross.click();

      expect(document.body.contains(el)).toBe(false);
    });
  });

  describe('confirm', () => {
    it('renders icon and preserves confirm/cancel buttons', () => {
      const el = confirm({
        message: 'Sure?',
        okHandler: vi.fn(),
        cancelHandler: vi.fn(),
      });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');
      const okBtn = el.querySelector('[data-blok-testid="notification-confirm-button"]');
      const cancelBtn = el.querySelector('[data-blok-testid="notification-cancel-button"]');

      expect(icon).not.toBeNull();
      expect(okBtn).not.toBeNull();
      expect(cancelBtn).not.toBeNull();
    });
  });

  describe('prompt', () => {
    it('renders icon and preserves input field', () => {
      const el = prompt({
        message: 'Name?',
        okHandler: vi.fn(),
      });
      const icon = el.querySelector('[data-blok-testid="notification-icon"]');
      const input = el.querySelector('[data-blok-testid="notification-input"]');

      expect(icon).not.toBeNull();
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
  });
});
