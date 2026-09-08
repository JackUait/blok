import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasEscapeLayer, registerLayer } from '../../../../src/components/utils/dismissable-layer';

/**
 * Mutation-targeted coverage for `src/components/utils/dismissable-layer.ts`.
 *
 * PROVEN-EQUIVALENT survivors, both on the `if (!listeners.installed) return;`
 * guard inside `removeListeners` (line 194) - the `ConditionalExpression: false`
 * and the emptied `BlockStatement`. Both delete an early return that is never
 * taken, because `listeners.installed` is always `true` when `removeListeners`
 * runs:
 *
 * - `installed` is set `true` only by `ensureListeners`, and `registerLayer`
 *   calls it synchronously on the statement right after `stack.push(entry)`.
 * - `installed` is set `false` only by `removeListeners`.
 * - `removeListeners` has exactly one call site: inside the unregister closure,
 *   reached only when `stack.length === 0` immediately after a successful
 *   `splice`, which requires the entry to have been pushed - so at least one
 *   `ensureListeners` ran, and no `removeListeners` can have run since (that
 *   would need another splice, which would need another push plus its
 *   `ensureListeners`).
 *
 * The module exports only `hasEscapeLayer` and `registerLayer`, so no caller can
 * reach `removeListeners` by another route.
 */

const disposers: Array<() => void> = [];
const elements: HTMLElement[] = [];

const makeElement = (): HTMLElement => {
  const element = document.createElement('div');

  document.body.appendChild(element);
  elements.push(element);

  return element;
};

const track = (dispose: () => void): (() => void) => {
  disposers.push(dispose);

  return dispose;
};

const pressEscape = (): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

describe('dismissable-layer mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
    for (const element of elements) {
      element.remove();
    }
    disposers.length = 0;
    elements.length = 0;
    vi.restoreAllMocks();
  });

  it('ignores a pointerdown whose target is not a node', () => {
    const onDismiss = vi.fn();

    track(registerLayer({ element: makeElement(), onDismiss }));

    const event = new PointerEvent('pointerdown', { bubbles: true });

    // An own property shadows the prototype getter that dispatch writes through.
    Object.defineProperty(event, 'target', { value: null, configurable: true });
    document.dispatchEvent(event);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('leaves the layer beneath untouched when the top unregister runs twice', () => {
    const onDismissLower = vi.fn();
    const onDismissUpper = vi.fn();

    track(registerLayer({ element: makeElement(), onDismiss: onDismissLower }));

    const disposeUpper = track(registerLayer({ element: makeElement(), onDismiss: onDismissUpper }));

    disposeUpper();
    disposeUpper();

    expect(hasEscapeLayer()).toBe(true);

    pressEscape();

    expect(onDismissLower).toHaveBeenCalledTimes(1);
    expect(onDismissUpper).not.toHaveBeenCalled();
  });

  it('keeps the shared document listeners while a lower layer is still registered', () => {
    const onDismissLower = vi.fn();
    const onDismissUpper = vi.fn();

    track(registerLayer({ element: makeElement(), onDismiss: onDismissLower }));

    const disposeUpper = track(registerLayer({ element: makeElement(), onDismiss: onDismissUpper }));

    disposeUpper();
    pressEscape();

    expect(onDismissLower).toHaveBeenCalledTimes(1);
  });
});
