import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { show } from '../../../../src/components/utils/notifier/index';

const toast = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-testid^="notification"]');

describe('Notifier toast with actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((el) => el.remove());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((el) => el.remove());
  });

  it('stays past the default time', () => {
    show({ message: 'failed', actions: [ { label: 'Retry', onClick: () => undefined } ] });
    vi.advanceTimersByTime(60_000);

    expect(toast()?.getAttribute('data-state')).toBe('open');
  });

  it('closes from its close button', () => {
    show({ message: 'failed', actions: [ { label: 'Retry', onClick: () => undefined } ] });
    document.querySelector<HTMLButtonElement>('[data-blok-testid="notification-dismiss"]')?.click();

    expect(toast()?.getAttribute('data-state') ?? 'closed').toBe('closed');
  });

  it('still expires without actions', () => {
    show({ message: 'plain', time: 1000 });
    vi.advanceTimersByTime(1000);

    expect(toast()?.getAttribute('data-state') ?? 'closed').toBe('closed');
  });
});
