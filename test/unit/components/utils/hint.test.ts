import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/components/utils/popover/components/hint/hint.css', () => ({}));

import { Hint } from '../../../../src/components/utils/popover/components/hint';
import { css } from '../../../../src/components/utils/popover/components/hint/hint.const';

describe('Hint component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates root element with title and start alignment by default', () => {
    const hint = new Hint({
      title: 'Primary action',
    });

    const root = hint.getElement();
    // Title is the first child div
    const title = root.children[0];
    // Description would be the second child if present
    const description = root.children[1];

    expect(root.classList.contains(css.alignedStart)).toBe(true);
    expect(root.classList.contains(css.alignedCenter)).toBe(false);
    expect(title?.textContent).toBe('Primary action');
    expect(description).toBeUndefined();
  });

  it('renders description when provided', () => {
    const hint = new Hint({
      title: 'Primary action',
      description: 'Explains what the action does',
    });

    const root = hint.getElement();
    // Description is the second child div when provided
    const description = root.children[1];

    expect(description).toBeDefined();
    expect(description?.textContent).toBe('Explains what the action does');
  });

  it('applies center alignment class when alignment="center" is passed', () => {
    const hint = new Hint({
      title: 'Center aligned',
      alignment: 'center',
    });

    const root = hint.getElement();

    expect(root.classList.contains(css.alignedCenter)).toBe(true);
    expect(root.classList.contains(css.alignedStart)).toBe(false);
  });

  it('returns the same root element instance from getElement', () => {
    const hint = new Hint({
      title: 'Stable instance',
    });

    const firstCall = hint.getElement();
    const secondCall = hint.getElement();

    expect(secondCall).toBe(firstCall);
  });
});
