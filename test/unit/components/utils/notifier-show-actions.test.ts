import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismiss, resolve, RESOLVED_HOLD_MS, show } from '../../../../src/components/utils/notifier/index';

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

  it('dismiss closes the toast shown with those options', () => {
    const options = { message: 'failed', actions: [ { label: 'Retry', onClick: (): void => undefined } ] };

    show(options);
    dismiss(options);

    expect(toast()?.getAttribute('data-state') ?? 'closed').toBe('closed');
  });

  it('dismiss leaves a toast shown with other options alone', () => {
    show({ message: 'failed', actions: [ { label: 'Retry', onClick: (): void => undefined } ] });
    dismiss({ message: 'failed' });

    expect(toast()?.getAttribute('data-state')).toBe('open');
  });

  describe('resolve', () => {
    const card = (): { message: string; detail: string; thumbnails: (string | null)[]; actions: { label: string; onClick: () => void; primary: boolean }[] } => ({
      message: 'Image failed to load',
      detail: 'The link isn’t responding',
      thumbnails: [ null ],
      actions: [ { label: 'Retry', onClick: (): void => undefined, primary: true } ],
    });
    const part = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

    it('turns the card into a success card', async () => {
      const options = card();

      show(options);
      await Promise.resolve();
      resolve(options, 'Image restored');

      expect(toast()?.getAttribute('data-resolved')).toBe('true');
      expect(part('notification-message-text')?.textContent).toBe('Image restored');
      expect(part('notification-check')).not.toBeNull();
      expect(part('notification-thumb')).toBeNull();
      expect(part('notification-detail')).toBeNull();
      expect(part('notification-action')).toBeNull();
    });

    it('keeps its width when the content shrinks', () => {
      const options = card();

      show(options);
      vi.spyOn(toast() as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 546, 64));
      resolve(options, 'Image restored');

      expect(toast()?.style.width).toBe('546px');
    });

    it('closes itself after the hold', () => {
      const options = card();

      show(options);
      resolve(options, 'Image restored');
      vi.advanceTimersByTime(RESOLVED_HOLD_MS - 1);
      expect(toast()?.getAttribute('data-state')).toBe('open');
      vi.advanceTimersByTime(1);

      expect(toast()?.getAttribute('data-state') ?? 'closed').toBe('closed');
    });

    it('keeps focus inside the card when the focused button goes away', () => {
      const options = card();

      show(options);
      part('notification-action')?.focus();
      resolve(options, 'Image restored');

      expect(part('notification-dismiss')).toHaveFocus();
    });

    it('lets the old title, detail, tile and buttons leave as inert ghosts', async () => {
      const options = card();

      show(options);
      await Promise.resolve();
      resolve(options, 'Image restored');

      const ghosts = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-toast-ghost]'));

      expect(ghosts.map((ghost) => ghost.textContent).join('|')).toContain('Image failed to load');
      expect(ghosts.map((ghost) => ghost.textContent).join('|')).toContain('The link isn’t responding');
      expect(ghosts.map((ghost) => ghost.textContent).join('|')).toContain('Retry');
      expect(ghosts.every((ghost) => ghost.inert && ghost.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(ghosts.some((ghost) => ghost.querySelector('[data-blok-testid]') !== null || ghost.hasAttribute('data-blok-testid'))).toBe(false);
    });

    it('removes a ghost once it has faded', () => {
      const options = card();

      show(options);
      resolve(options, 'Image restored');
      document.querySelectorAll('[data-blok-toast-ghost]').forEach((ghost) => ghost.dispatchEvent(new Event('animationend')));

      expect(document.querySelector('[data-blok-toast-ghost]')).toBeNull();
    });

    it('gives the check a unit path length so it can draw itself', () => {
      const options = card();

      show(options);
      resolve(options, 'Image restored');

      expect(part('notification-check')?.querySelector('path')?.getAttribute('pathLength')).toBe('1');
    });

    it('glides to its new height, then lets go of it', () => {
      const options = card();

      show(options);
      vi.spyOn(toast() as HTMLElement, 'getBoundingClientRect')
        .mockReturnValueOnce(new DOMRect(0, 0, 546, 64))
        .mockReturnValue(new DOMRect(0, 0, 546, 48));
      resolve(options, 'Image restored');

      expect(toast()?.style.height).toBe('64px');
      toast()?.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'height' }));

      expect(toast()?.style.height).toBe('');
    });

    it('ignores options it never showed', () => {
      show(card());
      resolve(card(), 'Image restored');

      expect(toast()?.hasAttribute('data-resolved')).toBe(false);
    });
  });
});
