/**
 * Mutation-hardening tests for
 * `src/components/modules/drag/utils/findScrollableAncestor.ts`.
 *
 * Both early returns stop the walk at `document.body`. The existing suite never
 * made body or the root element scrollable, so dropping either guard changed
 * nothing: the walk simply carried on and still ended at null. These fixtures
 * make the elements past the guard scrollable, so skipping a guard returns an
 * element instead.
 *
 * No equivalent survivors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { findScrollableAncestor } from '../../../../../../src/components/modules/drag/utils/findScrollableAncestor';

describe('findScrollableAncestor — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();

    document.body.style.overflowY = '';
    document.documentElement.style.overflowY = '';

    // Own properties shadow the prototype getters; deleting restores jsdom's.
    Reflect.deleteProperty(document.body, 'scrollHeight');
    Reflect.deleteProperty(document.body, 'clientHeight');
    Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    Reflect.deleteProperty(document.documentElement, 'clientHeight');

    document.body.replaceChildren();
  });

  it('stops at document.body even when body itself scrolls', () => {
    document.body.style.overflowY = 'auto';
    Object.defineProperty(document.body, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(document.body, 'clientHeight', { value: 100, configurable: true });

    const child = document.createElement('div');

    document.body.appendChild(child);

    expect(findScrollableAncestor(child)).toBeNull();
  });

  it('returns null for document.body itself even when the root element scrolls', () => {
    document.documentElement.style.overflowY = 'auto';
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 100, configurable: true });

    expect(findScrollableAncestor(document.body)).toBeNull();
  });

  it('still finds a scrollable ancestor that sits below body', () => {
    document.body.style.overflowY = 'auto';
    Object.defineProperty(document.body, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(document.body, 'clientHeight', { value: 100, configurable: true });

    const scrollable = document.createElement('div');
    const child = document.createElement('div');

    scrollable.style.overflowY = 'scroll';
    Object.defineProperty(scrollable, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scrollable, 'clientHeight', { value: 50, configurable: true });

    scrollable.appendChild(child);
    document.body.appendChild(scrollable);

    expect(findScrollableAncestor(child)).toBe(scrollable);
  });
});
