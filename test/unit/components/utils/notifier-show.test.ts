import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the notifier show module (index.ts).
 * Covers progress bar rendering for alerts and exit animations.
 */

vi.mock('../../../../src/components/utils/notifier/draw', () => {
  const createMockAlert = (options: { message: string; style?: string }): HTMLElement => {
    const div = document.createElement('div');

    div.setAttribute('data-blok-testid', options.style ? `notification-${options.style}` : 'notification');
    div.innerHTML = options.message;

    // Add a mock cross button matching real draw.ts structure
    const cross = document.createElement('div');

    cross.setAttribute('data-blok-testid', 'notification-cross');
    cross.addEventListener('click', () => div.remove());
    div.appendChild(cross);

    return div;
  };

  const createProgressBar = (style?: string, time?: number): HTMLElement => {
    const bar = document.createElement('div');

    bar.setAttribute('data-blok-testid', 'notification-progress');
    bar.style.animationDuration = `${time ?? 8000}ms`;

    return bar;
  };

  return {
    alert: vi.fn((options: { message: string; style?: string }) => createMockAlert(options)),
    confirm: vi.fn((options: { message: string; style?: string }) => createMockAlert(options)),
    prompt: vi.fn((options: { message: string; style?: string }) => createMockAlert(options)),
    createProgressBar: vi.fn(createProgressBar),
    getWrapper: vi.fn(() => {
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-testid', 'notifier-container');

      return wrapper;
    }),
  };
});

const { show } = await import('../../../../src/components/utils/notifier/index');

describe('Notifier show (index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Clean up any existing wrapper
    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((el) => el.remove());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((el) => el.remove());
  });

  it('appends a progress bar to alert notifications', () => {
    show({ message: 'test alert', time: 5000 });

    const notification = document.querySelector('[data-blok-testid^="notification"]');
    const progressBar = notification?.querySelector('[data-blok-testid="notification-progress"]');

    expect(progressBar).not.toBeNull();
  });

  it('sets progress bar animation duration to match the time option', () => {
    show({ message: 'timed', time: 3000 });

    const notification = document.querySelector('[data-blok-testid^="notification"]');
    const progressBar = notification?.querySelector('[data-blok-testid="notification-progress"]') as HTMLElement;

    expect(progressBar).not.toBeNull();
    expect(progressBar.style.animationDuration).toBe('3000ms');
  });

  it('uses default time (8000ms) for progress bar when time is not specified', () => {
    show({ message: 'default time' });

    const notification = document.querySelector('[data-blok-testid^="notification"]');
    const progressBar = notification?.querySelector('[data-blok-testid="notification-progress"]') as HTMLElement;

    expect(progressBar).not.toBeNull();
    expect(progressBar.style.animationDuration).toBe('8000ms');
  });

  it('does not add progress bar to confirm notifications', () => {
    show({ message: 'confirm?', type: 'confirm' });

    const notification = document.querySelector('[data-blok-testid^="notification"]');
    const progressBar = notification?.querySelector('[data-blok-testid="notification-progress"]');

    expect(progressBar).toBeNull();
  });

  it('does not add progress bar to prompt notifications', () => {
    show({ message: 'prompt?', type: 'prompt' });

    const notification = document.querySelector('[data-blok-testid^="notification"]');
    const progressBar = notification?.querySelector('[data-blok-testid="notification-progress"]');

    expect(progressBar).toBeNull();
  });

  it('applies entrance animation class to notification', () => {
    show({ message: 'animate' });

    const notification = document.querySelector('[data-blok-testid^="notification"]');

    expect(notification?.className).toContain('animate-notify-slide-in');
  });

  it('applies exit animation class before removing alert on timeout', () => {
    show({ message: 'will exit', time: 5000 });

    const notification = document.querySelector('[data-blok-testid^="notification"]') as HTMLElement;

    expect(notification).not.toBeNull();

    // Advance past the auto-dismiss timeout
    vi.advanceTimersByTime(5000);

    // Should have exit animation class applied
    expect(notification.className).toContain('animate-notify-slide-out');
  });

  it('ignores show calls with empty message', () => {
    show({ message: '' });

    const notification = document.querySelector('[data-blok-testid^="notification"]');

    expect(notification).toBeNull();
  });
});
