import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLeaveBanner } from '../../../../src/components/utils/leave-banner';
import { show } from '../../../../src/components/utils/notifier/index';

const labels = { title: 'Some images have problems', retry: 'Retry', show: 'Show', stay: 'Stay', leave: 'Leave anyway' };

describe('leave banner under an open failure toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('answers Escape with Stay instead of closing the toast', () => {
    const onStay = vi.fn();

    show({ message: 'Image failed to load', actions: [ { label: 'Retry', onClick: () => undefined } ] });
    const banner = openLeaveBanner("Won't display: 1", labels, { onRetry: vi.fn(), onShow: vi.fn(), onStay, onLeave: vi.fn() });

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-blok-testid="notification"]')?.getAttribute('data-state')).toBe('open');
    banner.close();
  });
});
