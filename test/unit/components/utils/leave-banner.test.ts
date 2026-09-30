import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLeaveBanner } from '../../../../src/components/utils/leave-banner';

const labels = { title: 'Some images have problems', retry: 'Retry', show: 'Show', stay: 'Stay', leave: 'Leave anyway' };

const handlers = (): { onRetry: () => void; onShow: () => void; onStay: () => void; onLeave: () => void } => ({
  onRetry: vi.fn(),
  onShow: vi.fn(),
  onStay: vi.fn(),
  onLeave: vi.fn(),
});

const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

describe('openLeaveBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('is an alertdialog named by its title with focus on the first button', () => {
    openLeaveBanner("Won't be saved: 2", labels, handlers());
    const banner = byId('leave-banner');

    expect(banner?.getAttribute('role')).toBe('alertdialog');
    expect(document.getElementById(banner?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(labels.title);
    expect(document.getElementById(banner?.getAttribute('aria-describedby') ?? '')?.textContent).toBe("Won't be saved: 2");
    expect(byId('leave-banner-retry')).toHaveFocus();
  });

  it('is rounded as a dialog, with no toast surface radius left to fight it', () => {
    openLeaveBanner('s', labels, handlers());
    const classes = (byId('leave-banner')?.className ?? '').split(' ');

    expect(classes.filter((c) => c.startsWith('rounded'))).toEqual([ 'rounded-(--blok-radius-dialog)' ]);
  });

  it('sits inside a blok styling scope, since it is mounted on body', () => {
    openLeaveBanner('s', labels, handlers());

    expect(byId('leave-banner')?.getAttribute('data-blok-interface')).toBe('leave-banner');
  });

  it('runs the matching handler for each button', () => {
    const h = handlers();

    openLeaveBanner('s', labels, h);
    [ 'retry', 'show', 'stay', 'leave' ].forEach((id) => byId(`leave-banner-${id}`)?.click());

    expect([ h.onRetry, h.onShow, h.onStay, h.onLeave ].map((f) => vi.mocked(f).mock.calls.length)).toEqual([ 1, 1, 1, 1 ]);
  });

  it('treats Escape as Stay', () => {
    const h = handlers();

    openLeaveBanner('s', labels, h);
    byId('leave-banner-show')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(h.onStay).toHaveBeenCalledTimes(1);
  });

  it('updates the summary and closes', () => {
    const banner = openLeaveBanner('a', labels, handlers());

    banner.update('b');
    expect(byId('leave-banner-summary')?.textContent).toBe('b');
    banner.close();
    expect(byId('leave-banner')).toBeNull();
  });

  it('gives focus back on close', () => {
    const before = document.createElement('button');

    document.body.appendChild(before);
    before.focus();
    openLeaveBanner('s', labels, handlers()).close();

    expect(before).toHaveFocus();
  });

  it('writes labels as text, not HTML', () => {
    openLeaveBanner('<b>s</b>', { ...labels, title: '<b>t</b>' }, handlers());

    expect(byId('leave-banner')?.querySelector('b')).toBeNull();
  });

  describe('as a modal', () => {
    const press = (target: HTMLElement | null, key: string, shiftKey = false): void => {
      target?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    };

    it('declares itself modal', () => {
      openLeaveBanner('s', labels, handlers());

      expect(byId('leave-banner')?.getAttribute('aria-modal')).toBe('true');
    });

    it('wraps Tab from the last button to the first, and Shift+Tab back', () => {
      openLeaveBanner('s', labels, handlers());
      const leave = byId('leave-banner-leave');

      leave?.focus();
      press(leave, 'Tab');
      expect(byId('leave-banner-retry')).toHaveFocus();

      press(byId('leave-banner-retry'), 'Tab', true);
      expect(leave).toHaveFocus();
    });

    it('pulls focus back when something behind it is focused', () => {
      const behind = document.createElement('button');

      document.body.appendChild(behind);
      openLeaveBanner('s', labels, handlers());
      behind.focus();

      expect(behind).not.toHaveFocus();
      expect(byId('leave-banner')?.contains(document.activeElement)).toBe(true);
    });

    it('makes the page behind inert while open and releases it on close', () => {
      const page = document.createElement('main');

      document.body.appendChild(page);
      const banner = openLeaveBanner('s', labels, handlers());

      expect(page.hasAttribute('inert')).toBe(true);
      expect(byId('leave-banner')?.hasAttribute('inert')).toBe(false);

      banner.close();
      expect(page.hasAttribute('inert')).toBe(false);
    });

    it('stops treating Escape as Stay once closed', () => {
      const h = handlers();

      openLeaveBanner('s', labels, h).close();
      press(document.body, 'Escape');

      expect(h.onStay).not.toHaveBeenCalled();
    });
  });
});
