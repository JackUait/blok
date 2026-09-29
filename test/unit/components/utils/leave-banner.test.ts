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
});
