import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { DatabaseKeyboard } from '../../../../src/tools/database/database-keyboard';

interface Fixture {
  wrapper: HTMLElement;
  keyboard: DatabaseKeyboard;
  onEscape: Mock<() => boolean>;
  remove: Mock<(type: string, listener: EventListenerOrEventListenerObject) => void>;
}

const build = (handled = true): Fixture => {
  const wrapper = document.createElement('div');
  const onEscape = vi.fn<() => boolean>(() => handled);
  const remove = vi.fn<(type: string, listener: EventListenerOrEventListenerObject) => void>();

  vi.spyOn(wrapper, 'removeEventListener').mockImplementation(remove);
  document.body.appendChild(wrapper);

  return { wrapper, keyboard: new DatabaseKeyboard({ wrapper, onEscape }), onEscape, remove };
};

const press = (target: HTMLElement, key: string): boolean => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  let reachedParent = false;

  document.body.addEventListener('keydown', () => {
    reachedParent = true;
  }, { once: true });
  target.dispatchEvent(event);

  return reachedParent;
};

describe('database keyboard mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('stops an Escape the host handled from reaching anything above', () => {
    const fixture = build(true);

    fixture.keyboard.attach();

    expect(press(fixture.wrapper, 'Escape')).toBe(false);
    expect(fixture.onEscape).toHaveBeenCalledTimes(1);
  });

  it('lets an Escape the host declined keep travelling', () => {
    const fixture = build(false);

    fixture.keyboard.attach();

    expect(press(fixture.wrapper, 'Escape')).toBe(true);
  });

  it('ignores every other key', () => {
    const fixture = build();

    fixture.keyboard.attach();

    expect(press(fixture.wrapper, 'a')).toBe(true);
    expect(fixture.onEscape).not.toHaveBeenCalled();
  });

  it('unbinds on destroy, and asks for no removal it never bound', () => {
    const fixture = build();

    fixture.keyboard.destroy();

    expect(fixture.remove).not.toHaveBeenCalled();

    fixture.keyboard.attach();
    fixture.keyboard.destroy();

    expect(fixture.remove).toHaveBeenCalledTimes(1);
  });
});
