import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureStrongElement,
  isBoldElement,
  isNodeWithin,
} from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

/**
 * Mutation-targeted coverage for
 * `src/components/inline-tools/utils/bold-dom-utils.ts`.
 *
 * PROVEN-EQUIVALENT survivors:
 *
 * - `ConditionalExpression: true` on `element.hasAttributes()` (line 30). Per
 *   DOM, `hasAttributes()` is true exactly when the attribute list is not empty,
 *   so when it is false `element.attributes.length` is 0 and the guarded
 *   `Array.from(...).forEach(...)` body runs zero times. Probed in jsdom: a fresh
 *   `div` reports `hasAttributes() === false` and `attributes.length === 0`.
 * - `ConditionalExpression: false` on `!target`, and the emptied `BlockStatement`
 *   of the same guard, in `isNodeWithin` (line 51). Both drop the early
 *   `return false` for a nullish target. Falling through then evaluates
 *   `target === container || container.contains(target)`; `container` is typed
 *   `Node` (non-null) so the identity test is false, and jsdom returns false for
 *   `contains(null)` and `contains(undefined)` - WebIDL maps both to the nullable
 *   `Node?` null. Same `false` result. Equivalent under the declared signature:
 *   the mutants differ only for a `null` container, which the type forbids.
 * - `ConditionalExpression: false` on `target === container` (line 55). The
 *   remaining disjunct `container.contains(target)` already covers it, because
 *   `contains` tests INCLUSIVE descendants - a node contains itself. Probed in
 *   jsdom: `div.contains(div) === true`.
 */

describe('bold-dom-utils mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('refuses to certify a non-element node that carries a bold tagName', () => {
    const text = document.createTextNode('bold-ish');

    // The nodeType check is the only thing standing between the `node is Element`
    // predicate and a node that merely looks like a tag.
    Object.defineProperty(text, 'tagName', { value: 'B', configurable: true });

    expect(isBoldElement(text)).toBe(false);
  });

  it('returns the very same element when it is already a STRONG', () => {
    const host = document.createElement('p');
    const strong = document.createElement('strong');

    strong.textContent = 'kept';
    host.appendChild(strong);
    document.body.appendChild(host);

    expect(ensureStrongElement(strong)).toBe(strong);
    expect(host.firstElementChild).toBe(strong);
  });

  it('replaces a B element with a STRONG that keeps its attributes and children', () => {
    const host = document.createElement('p');
    const bold = document.createElement('b');

    bold.setAttribute('data-mark-id', 'm1');
    bold.textContent = 'moved';
    host.appendChild(bold);
    document.body.appendChild(host);

    const result = ensureStrongElement(bold);

    expect(result.tagName).toBe('STRONG');
    expect(result.getAttribute('data-mark-id')).toBe('m1');
    expect(host.innerHTML).toBe('<strong data-mark-id="m1">moved</strong>');
  });

  it('treats a container as within itself', () => {
    const container = document.createElement('div');

    expect(isNodeWithin(container, container)).toBe(true);
  });
});
