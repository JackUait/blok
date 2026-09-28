import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyboardEngagement } from '../../../../../src/components/utils/popover/keyboard-engagement';

describe('KeyboardEngagement', () => {
  const root = document.createElement('div');
  const inside = document.createElement('input');
  const outside = document.createElement('input');
  const trackers: KeyboardEngagement[] = [];

  const track = (openedByKeyboard: boolean): KeyboardEngagement => {
    const tracker = new KeyboardEngagement(root, openedByKeyboard);

    trackers.push(tracker);

    return tracker;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    root.appendChild(inside);
    document.body.append(root, outside);
  });

  afterEach(() => {
    trackers.splice(0).forEach(tracker => tracker.destroy());
    root.remove();
    outside.remove();
    vi.restoreAllMocks();
  });

  it('is not engaged by focus alone: a surface that focused itself on open is still pointer-driven', () => {
    const tracker = track(false);

    inside.focus();

    expect(tracker.isEngaged).toBe(false);
  });

  it('is engaged when a key is pressed inside the surface', () => {
    const tracker = track(false);

    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(tracker.isEngaged).toBe(true);
  });

  it('ignores keys pressed outside the surface', () => {
    const tracker = track(false);

    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(tracker.isEngaged).toBe(false);
  });

  it('sees a key even when a handler inside stops its propagation', () => {
    const tracker = track(false);

    inside.addEventListener('keydown', event => event.stopImmediatePropagation(), { once: true });
    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(tracker.isEngaged).toBe(true);
  });

  it('starts engaged when the keyboard opened the surface', () => {
    expect(track(true).isEngaged).toBe(true);
  });

  it('stops listening once destroyed', () => {
    const tracker = track(false);

    tracker.destroy();
    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(tracker.isEngaged).toBe(false);
  });
});
