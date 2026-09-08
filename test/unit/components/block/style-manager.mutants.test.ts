/**
 * Mutation-hardening tests for `src/components/block/style-manager.ts`.
 *
 * The existing suite asserts what a state ADDS to the content classes, never
 * what it must leave out, so a mutant that widens a branch stayed invisible.
 * These tests assert the absent half as well, and call `setStretchState` with
 * one argument so its default is exercised.
 *
 * No equivalent survivors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { StyleManager } from '../../../../src/components/block/style-manager';

describe('StyleManager — mutation hardening', () => {
  let holder: HTMLDivElement;
  let contentElement: HTMLDivElement;
  let styleManager: StyleManager;

  beforeEach(() => {
    vi.clearAllMocks();

    holder = document.createElement('div');
    contentElement = document.createElement('div');
    holder.appendChild(contentElement);
    styleManager = new StyleManager(holder, contentElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    holder.remove();
  });

  it('treats an omitted selection state as unselected', () => {
    contentElement.className = 'sentinel';

    styleManager.setStretchState(true);

    expect(contentElement.className).not.toContain('sentinel');
    expect(contentElement.className).toContain('max-w-none');
  });

  it('does not add selection styling when stretching an unselected block', () => {
    styleManager.setStretchState(true, false);

    expect(contentElement.className).not.toContain('bg-selection');
    expect(contentElement.className).toContain('max-w-none');
  });

  it('keeps the stretched width out of the selected-only classes', () => {
    const selectedOnly = styleManager.getContentClasses(true, false);

    expect(selectedOnly).not.toContain('max-w-none');
    expect(selectedOnly).toContain('bg-selection');
    expect(selectedOnly).toContain('max-w-blok-content');
  });

  it('keeps selection styling out of the stretched-only classes', () => {
    const stretchedOnly = styleManager.getContentClasses(false, true);

    expect(stretchedOnly).not.toContain('bg-selection');
    expect(stretchedOnly).toContain('max-w-none');
  });
});
