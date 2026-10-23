import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../src/components/constants';
import { destroy, HINT_DELAY, onHover } from '../../../../src/components/utils/tooltip';

const isShown = (): boolean =>
  document.querySelector(`[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`)?.getAttribute('aria-hidden') === 'false';

/** A removed trigger never gets a pointerleave, so nothing else would close its hint (findings-listgallery L23). */
describe('a hint whose trigger leaves the page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('closes when its trigger is removed, as when blok.render() redraws the view', async () => {
    const host = document.createElement('div');
    const trigger = document.createElement('button');

    trigger.getBoundingClientRect = vi.fn(() => DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 40 }));
    host.appendChild(trigger);
    document.body.appendChild(host);
    onHover(trigger, 'Tags');
    trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    expect(isShown()).toBe(true);

    host.replaceChildren();
    await Promise.resolve();

    expect(isShown()).toBe(false);
  });

  it('stays open while its trigger stays in the page', async () => {
    const trigger = document.createElement('button');

    trigger.getBoundingClientRect = vi.fn(() => DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 40 }));
    document.body.appendChild(trigger);
    onHover(trigger, 'Tags');
    trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();

    expect(isShown()).toBe(true);
  });
});
