// test/unit/tools/callout/dom-builder.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

describe('buildCalloutDOM', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns wrapper, emojiButton, and childContainer (no textElement)', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const result = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(result.wrapper).toBeInstanceOf(HTMLElement);
    expect(result.emojiButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.childContainer).toBeInstanceOf(HTMLElement);
    expect(result).not.toHaveProperty('textElement');
  });

  it('wrapper is a flex row with emoji and childContainer as direct children', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { wrapper, emojiButton, childContainer } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.children[0]).toBe(emojiButton);
    expect(wrapper.children[1]).toBe(childContainer);
  });

  it('child container has data-blok-toggle-children attribute', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { childContainer } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(childContainer.hasAttribute(TOGGLE_ATTR.toggleChildren)).toBe(true);
  });

  it('child container has data-blok-mutation-free attribute', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { childContainer } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(childContainer.getAttribute('data-blok-mutation-free')).toBe('true');
  });

  it('emoji button is disabled in readOnly mode', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', readOnly: true, addEmojiLabel: 'Add emoji' });

    expect(emojiButton.disabled).toBe(true);
  });

  it('emoji button aria-label = addEmojiLabel when emoji is empty', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(emojiButton.getAttribute('aria-label')).toBe('Add emoji');
  });

  it('emoji button aria-label = emoji char when emoji is set', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(emojiButton.getAttribute('aria-label')).toBe('💡');
  });

  it('emoji button aligns to start of first line', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(emojiButton.className).toContain('py-[7px]');
    expect(emojiButton.className).toContain('flex-shrink-0');
  });

  it('childContainer fills remaining space', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { childContainer } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(childContainer.className).toContain('flex-1');
    expect(childContainer.className).toContain('min-w-0');
  });
});
