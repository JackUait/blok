import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTabbables, openModalDialog } from '../../../../src/components/utils/modal-dialog';

/**
 * jsdom ships no HTML Popover API; promoteToTopLayer needs the minimal shape.
 */
const installPopoverStub = (): void => {
  if (!('popover' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('popover');
      },
      set(this: HTMLElement, value: string) {
        this.setAttribute('popover', value);
      },
    });
  }

  const proto = HTMLElement.prototype as unknown as { showPopover?: () => void; hidePopover?: () => void };

  if (typeof proto.showPopover !== 'function') {
    proto.showPopover = function showPopover() {};
    proto.hidePopover = function hidePopover() {};
  }
};

const makeButton = (id: string): HTMLButtonElement => {
  const button = document.createElement('button');

  button.id = id;
  button.textContent = id;

  return button;
};

const makeDiv = (id: string): HTMLDivElement => {
  const div = document.createElement('div');

  div.id = id;

  return div;
};

interface BuiltDialog {
  content: HTMLElement;
  surface: HTMLElement;
}

const buildDialog = (...controls: HTMLElement[]): BuiltDialog => {
  const content = makeDiv('dialog-content');
  const surface = makeDiv('dialog-surface');

  surface.append(...controls);
  content.appendChild(surface);

  return { content, surface };
};

/** Chrome-shaped UA so supportsAnimations() stops short-circuiting the close. */
const pretendAnimationsRun = (): void => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
};

/** Makes getComputedStyle report one animation-name for every element. */
const stubAnimationName = (name: string): void => {
  const probe = document.createElement('div');

  probe.style.animationName = name;
  vi.spyOn(window, 'getComputedStyle').mockReturnValue(probe.style);
};

const animationEnd = (): Event => new Event('animationend', { bubbles: true });

beforeEach(() => {
  vi.clearAllMocks();
  installPopoverStub();
  // lastPointerPress is module state: a press recorded by an earlier test would
  // stand in as this test's focus-restore target.
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getTabbables', () => {
  it('drops every element a Tab press cannot reach', () => {
    const host = makeDiv('host');
    const link = document.createElement('a');

    link.id = 'link';
    link.href = '#target';

    const plain = makeButton('plain');
    const attrDisabled = makeButton('attr-disabled');

    attrDisabled.setAttribute('disabled', '');

    const negativeTabindex = makeButton('negative-tabindex');

    negativeTabindex.setAttribute('tabindex', '-1');

    const hiddenButton = makeButton('hidden-button');

    hiddenButton.setAttribute('hidden', '');

    const ariaHiddenButton = makeButton('aria-hidden-button');

    ariaHiddenButton.setAttribute('aria-hidden', 'true');

    const propDisabled = makeDiv('prop-disabled');

    propDisabled.setAttribute('tabindex', '0');
    // A `disabled` PROPERTY with no attribute — the only fixture that tells the
    // two halves of the disabled check apart, since native controls reflect one
    // into the other.
    Object.defineProperty(propDisabled, 'disabled', { value: true, configurable: true });

    const divAttrDisabled = makeDiv('div-attr-disabled');

    divAttrDisabled.setAttribute('tabindex', '0');
    divAttrDisabled.setAttribute('disabled', '');

    const field = document.createElement('input');

    field.id = 'field';

    const picker = document.createElement('select');

    picker.id = 'picker';

    const area = document.createElement('textarea');

    area.id = 'area';

    host.append(
      link,
      plain,
      attrDisabled,
      negativeTabindex,
      hiddenButton,
      ariaHiddenButton,
      propDisabled,
      divAttrDisabled,
      field,
      picker,
      area,
      makeDiv('untabbable')
    );
    document.body.appendChild(host);

    expect(getTabbables(host).map((el) => el.id)).toEqual(['link', 'plain', 'field', 'picker', 'area']);
  });
});

describe('openModalDialog — surface semantics', () => {
  it('defaults the role to dialog and writes no aria hook the caller withheld', () => {
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    expect(surface.getAttribute('role')).toBe('dialog');
    expect(surface.hasAttribute('aria-label')).toBe(false);
    expect(surface.hasAttribute('aria-labelledby')).toBe(false);
    expect(surface.hasAttribute('aria-describedby')).toBe(false);

    handle.close();
  });

  it('writes aria-labelledby when the caller passes one', () => {
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, labelledBy: 'dialog-title', onDismiss: vi.fn() });

    expect(surface.getAttribute('aria-labelledby')).toBe('dialog-title');

    handle.close();
  });

  it('leaves the Top Layer untouched in both directions when topLayer is false', () => {
    const { content, surface } = buildDialog(makeButton('only'));
    const removeAttribute = vi.spyOn(content, 'removeAttribute');
    const handle = openModalDialog({ content, surface, topLayer: false, onDismiss: vi.fn() });

    expect(content.hasAttribute('data-blok-top-layer')).toBe(false);

    handle.close();

    expect(removeAttribute.mock.calls.map((call) => call[0])).not.toContain('data-blok-top-layer');
  });
});

describe('openModalDialog — inert background', () => {
  it('marks siblings with a bare inert attribute', () => {
    const sibling = makeDiv('sibling');

    document.body.appendChild(sibling);

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    expect(sibling.getAttribute('inert')).toBe('');

    handle.close();
  });

  it('spares the body-level ancestor of a deeply nested interactive root', () => {
    const shell = makeDiv('shell');
    const middle = makeDiv('middle');
    const deep = makeDiv('deep');

    middle.appendChild(deep);
    shell.appendChild(middle);
    document.body.appendChild(shell);

    const elsewhere = makeDiv('elsewhere');

    document.body.appendChild(elsewhere);

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({
      content,
      surface,
      container: shell,
      interactiveRoot: deep,
      onDismiss: vi.fn(),
    });

    expect(shell.hasAttribute('inert')).toBe(false);
    expect(elsewhere.hasAttribute('inert')).toBe(true);

    handle.close();
  });

  it('inerts the whole page when the interactive root is not under body', () => {
    const sibling = makeDiv('sibling');

    document.body.appendChild(sibling);

    const { content, surface } = buildDialog(makeButton('only'));
    // A throw here is the failure: climbing off the top of the tree must end at null.
    const handle = openModalDialog({
      content,
      surface,
      interactiveRoot: makeDiv('detached-root'),
      onDismiss: vi.fn(),
    });

    expect(sibling.hasAttribute('inert')).toBe(true);

    handle.close();

    expect(sibling.hasAttribute('inert')).toBe(false);
  });

  it('applies inert once, so a subtree mounted after open stays interactive', async () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
    const late = makeDiv('late');

    document.body.appendChild(late);
    await Promise.resolve();

    expect(late.hasAttribute('inert')).toBe(false);

    handle.close();
  });

  it('inerts the page from the deferred pass when the caller mounts late', async () => {
    const sibling = makeDiv('sibling');

    document.body.appendChild(sibling);

    const target = makeButton('late-focus');
    const { content, surface } = buildDialog(target);
    const handle = openModalDialog({
      content,
      surface,
      container: null,
      topLayer: false,
      onDismiss: vi.fn(),
    });

    expect(sibling.hasAttribute('inert')).toBe(false);
    expect(target).not.toHaveFocus();

    document.body.appendChild(content);
    await Promise.resolve();

    expect(sibling.hasAttribute('inert')).toBe(true);
    expect(target).toHaveFocus();

    handle.close();
  });

  it('does not re-inert the page from a deferred pass that lands after close', async () => {
    const sibling = makeDiv('sibling');

    document.body.appendChild(sibling);

    const { content, surface } = buildDialog();
    const handle = openModalDialog({
      content,
      surface,
      container: null,
      topLayer: false,
      onDismiss: vi.fn(),
    });

    document.body.appendChild(content);
    handle.close();
    await Promise.resolve();

    expect(sibling.hasAttribute('inert')).toBe(false);
  });
});

describe('openModalDialog — Tab trap', () => {
  it('ignores keys other than Tab', () => {
    const first = makeButton('first');
    const last = makeButton('last');
    const { content, surface } = buildDialog(first, last);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

    expect(last).toHaveFocus();

    handle.close();
  });

  it('leaves a press in the middle of the ring alone', () => {
    const first = makeButton('first');
    const middle = makeButton('middle');
    const last = makeButton('last');
    const { content, surface } = buildDialog(first, middle, last);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    middle.focus();

    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    middle.dispatchEvent(forward);

    expect(middle).toHaveFocus();
    expect(forward.defaultPrevented).toBe(false);

    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });

    middle.dispatchEvent(backward);

    expect(middle).toHaveFocus();
    expect(backward.defaultPrevented).toBe(false);

    first.focus();

    const forwardFromFirst = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    first.dispatchEvent(forwardFromFirst);

    expect(first).toHaveFocus();
    expect(forwardFromFirst.defaultPrevented).toBe(false);

    handle.close();
  });

  it('wraps at both ends and consumes the press', () => {
    const first = makeButton('first');
    const middle = makeButton('middle');
    const last = makeButton('last');
    const { content, surface } = buildDialog(first, middle, last);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    last.focus();

    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    last.dispatchEvent(forward);

    expect(first).toHaveFocus();
    expect(forward.defaultPrevented).toBe(true);

    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });

    first.dispatchEvent(backward);

    expect(last).toHaveFocus();
    expect(backward.defaultPrevented).toBe(true);

    handle.close();
  });
});

describe('openModalDialog — focus containment', () => {
  it('pulls focus back to the first control when it escapes the surface', () => {
    const outside = makeButton('outside');

    document.body.appendChild(outside);

    const first = makeButton('first');
    const last = makeButton('last');
    const { content, surface } = buildDialog(first, last);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    // Parked on `last` first: if the guard never ran, focus would still be here.
    last.focus();
    expect(last).toHaveFocus();

    outside.focus();

    expect(first).toHaveFocus();

    handle.close();
  });

  it('guards focus from the capture phase, ahead of the page\'s own handlers', () => {
    const outside = makeButton('outside');

    outside.addEventListener('focusin', (event) => {
      event.stopPropagation();
    });
    document.body.appendChild(outside);

    const first = makeButton('first');
    const last = makeButton('last');
    const { content, surface } = buildDialog(first, last);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    last.focus();
    outside.focus();

    expect(first).toHaveFocus();

    handle.close();
  });

  it('does not chase focus into a surface that is not mounted', () => {
    const outside = makeButton('outside');

    document.body.appendChild(outside);

    const inside = makeButton('inside');
    const insideFocus = vi.spyOn(inside, 'focus');
    const { content, surface } = buildDialog(inside);
    const handle = openModalDialog({
      content,
      surface,
      container: null,
      topLayer: false,
      onDismiss: vi.fn(),
    });

    outside.focus();

    expect(insideFocus).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();

    handle.close();
  });
});

describe('openModalDialog — initial focus', () => {
  it('asks the caller for the focus target exactly once when it lands', async () => {
    const target = makeButton('target');
    const initialFocus = vi.fn(() => target);
    const { content, surface } = buildDialog(makeButton('other'), target);
    const handle = openModalDialog({ content, surface, initialFocus, onDismiss: vi.fn() });

    expect(target).toHaveFocus();

    await Promise.resolve();

    expect(initialFocus).toHaveBeenCalledTimes(1);
    expect(target).toHaveFocus();

    handle.close();
  });

  it('focuses a control the caller appends after open', async () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
    const late = makeButton('late');

    surface.appendChild(late);
    await Promise.resolve();

    expect(late).toHaveFocus();

    handle.close();
  });

  it('opens and closes a dialog that holds nothing focusable', () => {
    const { content, surface } = buildDialog();
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    expect(content.isConnected).toBe(true);

    handle.close();

    expect(content.isConnected).toBe(false);
  });
});

describe('openModalDialog — teardown', () => {
  it('dismisses on Escape while open and never once closed', () => {
    const onDismiss = vi.fn();
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onDismiss).toHaveBeenCalledWith('escape');

    handle.close();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('takes the Tab trap off the surface on close', () => {
    const first = makeButton('first');
    const last = makeButton('last');
    const { content, surface } = buildDialog(first, last);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();
    // Re-mounted so a surviving trap would be observable through focus.
    document.body.appendChild(content);
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(last).toHaveFocus();
  });

  it('unhooks the document focus guard with the same listener and phase', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
    const focusinCalls = addEventListener.mock.calls.filter((call) => call[0] === 'focusin');

    expect(focusinCalls).toHaveLength(1);

    const [, guard, capture] = focusinCalls[0];

    expect(capture).toBe(true);

    const removeEventListener = vi.spyOn(document, 'removeEventListener');

    handle.close();

    expect(removeEventListener).toHaveBeenCalledWith('focusin', guard, true);
  });

  it('runs the caller teardown once even when closed twice', () => {
    const onClose = vi.fn();
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn(), onClose });

    handle.close();
    handle.close();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not re-mark content when closeAnimated follows close', () => {
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();
    handle.closeAnimated();

    expect(content.hasAttribute('data-blok-closing')).toBe(false);
  });
});

describe('openModalDialog — focus restore', () => {
  it('hands focus to the control the opening press landed on', () => {
    const opener = makeButton('opener');
    const icon = document.createElement('span');

    opener.appendChild(icon);
    document.body.appendChild(opener);

    // WebKit leaves <body> focused after a click on a button, so the tracked
    // press is the only name for the opener.
    expect(document.body).toHaveFocus();

    icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();

    expect(opener).toHaveFocus();
  });
});

describe('openModalDialog — press tracking', () => {
  it('records the opening press in the capture phase, ahead of a page handler that swallows it', () => {
    const wrapper = makeDiv('wrapper');
    const opener = makeButton('opener');
    const icon = document.createElement('span');

    opener.appendChild(icon);
    wrapper.appendChild(opener);
    document.body.appendChild(wrapper);

    // Bubble-phase swallow: only a capture-phase document listener sees the press.
    wrapper.addEventListener('pointerdown', (event) => event.stopPropagation());

    icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.body).toHaveFocus();

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.close();

    expect(opener).toHaveFocus();
  });
});

describe('openModalDialog — animation support probe', () => {
  it('tears down at once when the environment reports no user agent', () => {
    // An animation name is set so a live probe would park the close instead.
    stubAnimationName('blok-fade');
    vi.stubGlobal('navigator', undefined);

    const onClose = vi.fn();
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn(), onClose });

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('openModalDialog — inert without a body', () => {
  it('leaves the page alone when the document exposes no body', () => {
    const sibling = makeDiv('sibling');

    document.body.appendChild(sibling);

    const { content, surface } = buildDialog(makeButton('only'));

    document.body.appendChild(content);

    const descriptor = Object.getOwnPropertyDescriptor(document, 'body');

    Object.defineProperty(document, 'body', { configurable: true, get: () => null });

    let handle: ReturnType<typeof openModalDialog> | undefined;
    let thrown: unknown = null;

    try {
      handle = openModalDialog({ content, surface, onDismiss: vi.fn() });
    } catch (error) {
      thrown = error;
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(document, 'body');
      } else {
        Object.defineProperty(document, 'body', descriptor);
      }
    }

    expect(thrown).toBeNull();
    expect(sibling.hasAttribute('inert')).toBe(false);
    expect(content.isConnected).toBe(true);

    handle?.close();
  });
});

describe('openModalDialog — deferred inert pass', () => {
  it('skips the deferred pass when the document is gone by then', () => {
    const queued: Array<() => void> = [];

    vi.stubGlobal('queueMicrotask', (callback: () => void) => {
      queued.push(callback);
    });

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({
      content,
      surface,
      container: null,
      topLayer: false,
      onDismiss: vi.fn(),
    });

    expect(content.isConnected).toBe(false);
    expect(queued).toHaveLength(1);

    vi.stubGlobal('document', undefined);

    expect(() => {
      for (const callback of queued) {
        callback();
      }
    }).not.toThrow();

    vi.unstubAllGlobals();

    handle.close();
  });
});

describe('openModalDialog — settle guard', () => {
  it('tears down once when the fallback timer outlives the animation', () => {
    pretendAnimationsRun();
    stubAnimationName('blok-fade');
    vi.useFakeTimers();

    const onClose = vi.fn();
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn(), onClose });
    const removeEventListener = vi.spyOn(surface, 'removeEventListener');

    // An engine that cannot cancel an already-queued timer task: the fallback
    // reaches the settle pass after the animation already tore the dialog down.
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {});

    const clearTimeout = vi.mocked(window.clearTimeout);

    handle.closeAnimated();
    surface.dispatchEvent(animationEnd());
    vi.advanceTimersByTime(400);

    expect(removeEventListener.mock.calls.filter((call) => call[0] === 'animationend')).toHaveLength(1);
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(content.isConnected).toBe(false);

    vi.useRealTimers();
  });

  it('does not cancel a fallback timer whose handle it does not hold yet', () => {
    pretendAnimationsRun();
    stubAnimationName('blok-fade');

    const onClose = vi.fn();
    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn(), onClose });
    const realSetTimeout = window.setTimeout;

    // The fallback runs before setTimeout returns its handle, so the cancel
    // step must not fire against the never-assigned initial value.
    // The bridge is type-only: the spy must match setTimeout's declared
    // signature, while the implementation deliberately returns early for the
    // fallback delay instead of scheduling.
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, timeout?: number, ...rest: unknown[]) => {
      if (timeout === 260) {
        callback();

        return 0;
      }

      return realSetTimeout(callback, timeout, ...rest);
    }) as unknown as typeof window.setTimeout);

    const clearTimeout = vi.spyOn(window, 'clearTimeout');

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(clearTimeout).not.toHaveBeenCalled();
  });
});

describe('openModalDialog — exit animation', () => {
  it('waits for the animation on the surface before tearing down', () => {
    pretendAnimationsRun();
    stubAnimationName('blok-fade');

    const onClose = vi.fn();
    const { content, surface } = buildDialog(makeButton('only'));
    const removeEventListener = vi.spyOn(surface, 'removeEventListener');
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn(), onClose });

    handle.closeAnimated();

    expect(content.isConnected).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(clearTimeout).not.toHaveBeenCalled();

    surface.dispatchEvent(animationEnd());

    expect(content.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('animationend', expect.any(Function));
    expect(clearTimeout).toHaveBeenCalledTimes(1);
  });

  it('ignores an animationend bubbling up from inside the panel', () => {
    pretendAnimationsRun();
    stubAnimationName('blok-fade');

    const inner = makeButton('inner');
    const { content, surface } = buildDialog(inner);
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();
    inner.dispatchEvent(animationEnd());

    expect(content.isConnected).toBe(true);

    surface.dispatchEvent(animationEnd());

    expect(content.isConnected).toBe(false);
  });

  it('tears down at once when the surface resolves to no animation', () => {
    pretendAnimationsRun();
    stubAnimationName('none');

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
  });

  it('tears down at once when the surface reports an empty animation name', () => {
    pretendAnimationsRun();
    stubAnimationName('');

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
  });

  it('tears down at once when reading the computed style throws', () => {
    pretendAnimationsRun();
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('no layout engine');
    });

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
  });

  it('skips the animation wait under jsdom even with an animation name', () => {
    stubAnimationName('blok-fade');

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
  });

  it('skips the animation wait when the user asked for reduced motion', () => {
    pretendAnimationsRun();
    stubAnimationName('blok-fade');

    const matchMedia = vi.fn(() => ({ matches: true }));

    vi.stubGlobal('matchMedia', matchMedia);

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();

    expect(content.isConnected).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('treats a matchMedia that answers with nothing as full motion', () => {
    pretendAnimationsRun();
    stubAnimationName('blok-fade');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => undefined)
    );

    const { content, surface } = buildDialog(makeButton('only'));
    const handle = openModalDialog({ content, surface, onDismiss: vi.fn() });

    handle.closeAnimated();

    expect(content.isConnected).toBe(true);

    surface.dispatchEvent(animationEnd());

    expect(content.isConnected).toBe(false);
  });
});
