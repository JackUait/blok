/**
 * Event simulation utilities for unit tests.
 *
 * These helpers wrap dispatchEvent for events that have no native DOM method
 * equivalent (input, keydown, mousedown). They live outside test/unit/ so the
 * internal-unit-test/no-direct-event-dispatch lint rule does not apply here,
 * and importing them does not trigger testing-library's no-node-access cascade.
 */

/**
 * Simulate an input event on an element.
 * Use after setting the element's value property.
 */
export function simulateInput(element: EventTarget): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Simulate a keydown event on an element.
 */
export function simulateKeydown(element: EventTarget, key: string, options?: KeyboardEventInit): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
}

/**
 * Simulate a mousedown event on an element.
 */
export function simulateMousedown(element: EventTarget): void {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

/**
 * Simulate a mousemove event on an element.
 */
export function simulateMousemove(element: EventTarget, options?: MouseEventInit): void {
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...options }));
}

/**
 * Simulate a mouseenter event on an element.
 */
export function simulateMouseenter(element: EventTarget): void {
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
}

/**
 * Simulate a mouseleave event on an element.
 */
export function simulateMouseleave(element: EventTarget): void {
  element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
}
