// test/unit/tools/callout/dom-builder.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

describe('buildCalloutDOM', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns wrapper, emojiButton, and childContainer', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const result = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(result.wrapper).toBeInstanceOf(HTMLElement);
    expect(result.emojiButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.childContainer).toBeInstanceOf(HTMLElement);
    expect(result).not.toHaveProperty('textElement');
    expect(result).not.toHaveProperty('dragZone');
  });

  it('wrapper is a flex row with emoji and childContainer as direct children', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { wrapper, emojiButton, childContainer } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.children[0]).toBe(emojiButton);
    expect(wrapper.children[1]).toBe(childContainer);
  });

  it('wrapper does not include a legacy [data-callout-drag-zone] element', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { wrapper } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(wrapper.querySelector('[data-callout-drag-zone]')).toBeNull();
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

  it('emoji button sizes the emoji relative to the callout text, not at a fixed 24px', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    // 1.5em of a 16px callout is the historical 24px. As `1.5rem` the emoji
    // ignored `style.fontSize.callout` entirely and sat 16.5px above the centre
    // of its text line at 1.5x.
    expect(emojiButton.className).toContain('text-[1.5em]');
  });

  it('emoji button aligns to start of first line', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    /**
     * The emoji's centre sits at `padding-top + 0.75em`; the body text's first
     * line centre sits at `--blok-block-padding-top + 0.75em` (its `blok-block`
     * padding and its `leading-[1.5]` line box). The em halves cancel, so the
     * button must take the SAME block-rhythm padding as the paragraph — a value
     * that deliberately does not scale with the font. Scaling it instead put the
     * emoji 3px off centre at 0.8x.
     */
    expect(emojiButton.className).toContain('pt-[var(--blok-block-padding-top,7px)]');
    expect(emojiButton.className).toContain('pb-[var(--blok-block-padding-bottom,7px)]');
    expect(emojiButton.className).toContain('flex-shrink-0');
  });

  it('sizes the emoji button as its own glyph plus that padding, so nothing is pinned to one font size', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    /**
     * `1em` of the button — whose font `text-[1.5em]` has already scaled — plus
     * the padding: the historical 38px at a 16px callout. `1.5em` here would
     * apply the 1.5 a second time, boxing a 24px emoji in a 36px line.
     */
    expect(emojiButton.className).toContain(
      'h-[calc(1em+var(--blok-block-padding-top,7px)+var(--blok-block-padding-bottom,7px))]'
    );
  });

  it('childContainer fills remaining space', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { childContainer } = buildCalloutDOM({ emoji: '💡', readOnly: false, addEmojiLabel: 'Add emoji' });

    expect(childContainer.className).toContain('flex-1');
    expect(childContainer.className).toContain('min-w-0');
  });
});
