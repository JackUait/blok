import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import Flipper from '../../../src/components/flipper';

const focusedClass = 'is-focused';

type KeydownOptions = {
  shiftKey?: boolean;
  target?: HTMLElement;
};

const createItems = (count = 3): HTMLElement[] => {
  return Array.from({ length: count }, (_, index) => {
    const button = document.createElement('button');

    button.textContent = `Item ${index + 1}`;
    document.body.appendChild(button);

    return button;
  });
};

const createKeyboardEvent = (
  key: string,
  options: KeydownOptions = {}
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: options.shiftKey ?? false,
  });

  const target = options.target ?? document.body;

  Object.defineProperty(event, 'target', {
    configurable: true,
    get: () => target,
  });

  Object.defineProperty(event, 'currentTarget', {
    configurable: true,
    get: () => target,
  });

  return event;
};

declare global {
  interface HTMLElement {
    scrollIntoViewIfNeeded?: (centerIfNeeded?: boolean) => void;
  }
}

describe('Flipper', () => {
  const originalScrollIntoViewIfNeeded = HTMLElement.prototype.scrollIntoViewIfNeeded;

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoViewIfNeeded', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterAll(() => {
    if (originalScrollIntoViewIfNeeded) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoViewIfNeeded', {
        configurable: true,
        value: originalScrollIntoViewIfNeeded,
      });
    } else {

      Object.defineProperty(HTMLElement.prototype, 'scrollIntoViewIfNeeded', {
        configurable: true,
        value: () => {},
      });
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('activates with provided items and cursor position and registers keydown listeners', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
    });
    const docAddSpy = vi.spyOn(document, 'addEventListener');
    const winAddSpy = vi.spyOn(window, 'addEventListener');

    flipper.activate(items, 1);

    expect(docAddSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(winAddSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(items[1].hasAttribute('data-blok-focused')).toBe(true);

    flipper.deactivate();
  });

  it('deactivates by removing listeners and clearing focused state', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
    const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

    flipper.activate();
    flipper.flipRight();

    expect(flipper.hasFocus()).toBe(true);

    flipper.deactivate();

    expect(docRemoveSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(winRemoveSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(flipper.hasFocus()).toBe(false);
  });

  it('handles arrow navigation and runs flip callbacks', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });
    const onFlipSpy = vi.fn();

    flipper.onFlip(onFlipSpy);
    flipper.activate();

    const event = createKeyboardEvent('ArrowDown');

    flipper.handleExternalKeydown(event);

    expect(onFlipSpy).toHaveBeenCalledTimes(1);
    expect(items[0].hasAttribute('data-blok-focused')).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    flipper.deactivate();
  });

  it('pressing Enter on a focused item triggers click and activate callback', () => {
    const items = createItems();
    const clickSpy = vi.fn();
    const activateSpy = vi.fn();

    items[0].addEventListener('click', clickSpy);

    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
      activateCallback: activateSpy,
    });

    flipper.activate();
    flipper.focusItem(0);

    const event = createKeyboardEvent('Enter');

    flipper.handleExternalKeydown(event);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(activateSpy).toHaveBeenCalledWith(items[0]);

    flipper.deactivate();
  });

  it('can toggle handling for contenteditable targets', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });

    flipper.activate();

    const editable = document.createElement('div');

    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', {
      configurable: true,
      get: () => true,
    });
    document.body.appendChild(editable);

    const initialEvent = createKeyboardEvent('ArrowDown', {
      target: editable,
    });

    flipper.handleExternalKeydown(initialEvent);

    expect(flipper.hasFocus()).toBe(false);

    flipper.setHandleContentEditableTargets(true);

    const secondEvent = createKeyboardEvent('ArrowDown', {
      target: editable,
    });

    flipper.handleExternalKeydown(secondEvent);

    expect(flipper.hasFocus()).toBe(true);

    flipper.deactivate();
  });

  it('respects native input opt-in for Tab handling', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });
    const input = document.createElement('input');

    document.body.appendChild(input);

    flipper.activate();

    const initialTabEvent = createKeyboardEvent('Tab', {
      target: input,
    });

    flipper.handleExternalKeydown(initialTabEvent);

    expect(flipper.hasFocus()).toBe(false);

    input.setAttribute('data-blok-flipper-navigation-target', 'true');

    const secondTabEvent = createKeyboardEvent('Tab', {
      target: input,
    });

    flipper.handleExternalKeydown(secondTabEvent);

    expect(flipper.hasFocus()).toBe(true);

    flipper.deactivate();
  });

  it('provides accurate activation state via getter', () => {
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
    });

    expect(flipper.isActivated).toBe(false);
    flipper.activate(createItems());
    expect(flipper.isActivated).toBe(true);
    flipper.deactivate();
    expect(flipper.isActivated).toBe(false);
  });

  it('focusFirst focuses the first item and scrolls it into view', () => {
    const items = createItems(2);
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });
    const scrollSpy = vi.spyOn(items[0], 'scrollIntoViewIfNeeded');

    scrollSpy.mockClear();

    flipper.activate();
    flipper.focusFirst();

    expect(items[0].hasAttribute('data-blok-focused')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    flipper.deactivate();
  });

  it('focusItem drops cursor for negative index', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });

    flipper.activate();
    flipper.focusItem(1);
    expect(items[1].hasAttribute('data-blok-focused')).toBe(true);

    flipper.focusItem(-1);
    expect(Array.from(items).some(item => item.hasAttribute('data-blok-focused'))).toBe(false);

    flipper.deactivate();
  });

  it('skips the first Tab movement after presetting initial focus', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });

    flipper.activate();
    flipper.focusItem(0);
    expect(items[0].hasAttribute('data-blok-focused')).toBe(true);

    const firstTabEvent = createKeyboardEvent('Tab');

    flipper.handleExternalKeydown(firstTabEvent);
    expect(items[0].hasAttribute('data-blok-focused')).toBe(true);

    const secondTabEvent = createKeyboardEvent('Tab');

    flipper.handleExternalKeydown(secondTabEvent);
    expect(items[1].hasAttribute('data-blok-focused')).toBe(true);

    flipper.deactivate();
  });

  it('removes onFlip callbacks when requested', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });
    const callback = vi.fn();

    flipper.onFlip(callback);
    flipper.activate();

    const initialEvent = createKeyboardEvent('ArrowDown');

    flipper.handleExternalKeydown(initialEvent);
    expect(callback).toHaveBeenCalledTimes(1);

    flipper.removeOnFlip(callback);
    const secondEvent = createKeyboardEvent('ArrowDown');

    flipper.handleExternalKeydown(secondEvent);
    expect(callback).toHaveBeenCalledTimes(1);

    flipper.deactivate();
  });

  it('handleExternalKeydown delegates handling logic', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });

    flipper.activate();

    const event = createKeyboardEvent('ArrowDown');

    flipper.handleExternalKeydown(event);

    expect(items[0].hasAttribute('data-blok-focused')).toBe(true);

    flipper.deactivate();
  });

  it('skips inline tool inputs unless explicitly allowed', () => {
    const items = createItems();
    const flipper = new Flipper({
      focusedItemClass: focusedClass,
      items,
    });
    const inlineToolInputWrapper = document.createElement('div');
    const inlineInput = document.createElement('input');

    inlineToolInputWrapper.setAttribute('data-blok-link-tool-input-opened', 'true');
    inlineToolInputWrapper.appendChild(inlineInput);
    document.body.appendChild(inlineToolInputWrapper);

    flipper.activate();

    const initialEvent = createKeyboardEvent('ArrowDown', {
      target: inlineInput,
    });

    flipper.handleExternalKeydown(initialEvent);
    expect(flipper.hasFocus()).toBe(false);

    inlineToolInputWrapper.removeAttribute('data-blok-link-tool-input-opened');
    inlineInput.setAttribute('data-blok-flipper-navigation-target', 'true');
    const secondEvent = createKeyboardEvent('Tab', {
      target: inlineInput,
    });

    flipper.handleExternalKeydown(secondEvent);
    expect(flipper.hasFocus()).toBe(true);

    flipper.deactivate();
  });
});


