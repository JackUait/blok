/**
 * Tests for findScrollableAncestor utility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findScrollableAncestor } from '../../../../../../src/components/modules/drag/utils/findScrollableAncestor';

describe('findScrollableAncestor', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Create a clean DOM environment
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should return null when element is null', () => {
    expect(findScrollableAncestor(null)).toBeNull();
  });

  it('should return null when element is document.body', () => {
    expect(findScrollableAncestor(document.body)).toBeNull();
  });

  it('should return null when no scrollable ancestor exists', () => {
    const nonScrollable = document.createElement('div');
    nonScrollable.style.overflow = 'visible';
    container.appendChild(nonScrollable);

    const result = findScrollableAncestor(nonScrollable);

    expect(result).toBeNull();
  });

  it('should find parent with overflow-y auto when content overflows', () => {
    const child = document.createElement('div');
    const scrollableParent = document.createElement('div');

    scrollableParent.style.overflowY = 'auto';
    // Make content overflow
    Object.defineProperty(scrollableParent, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scrollableParent, 'clientHeight', { value: 100, configurable: true });

    scrollableParent.appendChild(child);
    container.appendChild(scrollableParent);

    const result = findScrollableAncestor(child);

    expect(result).toBe(scrollableParent);
  });

  it('should find parent with overflow-y scroll when content overflows', () => {
    const child = document.createElement('div');
    const scrollableParent = document.createElement('div');

    scrollableParent.style.overflowY = 'scroll';
    Object.defineProperty(scrollableParent, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scrollableParent, 'clientHeight', { value: 100, configurable: true });

    scrollableParent.appendChild(child);
    container.appendChild(scrollableParent);

    const result = findScrollableAncestor(child);

    expect(result).toBe(scrollableParent);
  });

  it('should not match parent with overflow-y auto when content does not overflow', () => {
    const child = document.createElement('div');
    const nonScrollableParent = document.createElement('div');

    nonScrollableParent.style.overflowY = 'auto';
    // Content doesn't overflow
    Object.defineProperty(nonScrollableParent, 'scrollHeight', { value: 100, configurable: true });
    Object.defineProperty(nonScrollableParent, 'clientHeight', { value: 100, configurable: true });

    nonScrollableParent.appendChild(child);
    container.appendChild(nonScrollableParent);

    const result = findScrollableAncestor(child);

    expect(result).toBeNull();
  });

  it('should not match parent with overflow-y visible', () => {
    const child = document.createElement('div');
    const parent = document.createElement('div');

    parent.style.overflowY = 'visible';
    Object.defineProperty(parent, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(parent, 'clientHeight', { value: 100, configurable: true });

    parent.appendChild(child);
    container.appendChild(parent);

    const result = findScrollableAncestor(child);

    expect(result).toBeNull();
  });

  it('should not match parent with overflow-y hidden', () => {
    const child = document.createElement('div');
    const parent = document.createElement('div');

    parent.style.overflowY = 'hidden';
    Object.defineProperty(parent, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(parent, 'clientHeight', { value: 100, configurable: true });

    parent.appendChild(child);
    container.appendChild(parent);

    const result = findScrollableAncestor(child);

    expect(result).toBeNull();
  });

  it('should search up the tree to find scrollable ancestor', () => {
    const child = document.createElement('div');
    const middle = document.createElement('div');
    const scrollableParent = document.createElement('div');

    scrollableParent.style.overflowY = 'auto';
    Object.defineProperty(scrollableParent, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scrollableParent, 'clientHeight', { value: 100, configurable: true });

    middle.appendChild(child);
    scrollableParent.appendChild(middle);
    container.appendChild(scrollableParent);

    const result = findScrollableAncestor(child);

    expect(result).toBe(scrollableParent);
  });

  it('should stop searching when reaching body', () => {
    const child = document.createElement('div');

    // Append directly to body (which has no overflow)
    document.body.appendChild(child);

    const result = findScrollableAncestor(child);

    expect(result).toBeNull();
  });
});
