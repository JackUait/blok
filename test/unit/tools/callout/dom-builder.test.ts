// test/unit/tools/callout/dom-builder.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

describe('buildCalloutDOM', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns wrapper, emojiButton, textElement, childContainer', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const result = buildCalloutDOM({ emoji: '💡', text: 'hello', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(result.wrapper).toBeInstanceOf(HTMLElement);
    expect(result.emojiButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.textElement).toBeInstanceOf(HTMLElement);
    expect(result.childContainer).toBeInstanceOf(HTMLElement);
  });

  it('child container has data-blok-toggle-children attribute', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { childContainer } = buildCalloutDOM({ emoji: '💡', text: '', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(childContainer.hasAttribute(TOGGLE_ATTR.toggleChildren)).toBe(true);
  });

  it('child container has data-blok-mutation-free attribute', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { childContainer } = buildCalloutDOM({ emoji: '💡', text: '', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(childContainer.getAttribute('data-blok-mutation-free')).toBe('true');
  });

  it('textElement is contentEditable in non-readOnly mode', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { textElement } = buildCalloutDOM({ emoji: '💡', text: 'hi', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(textElement.contentEditable).toBe('true');
  });

  it('textElement is not contentEditable in readOnly mode', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { textElement } = buildCalloutDOM({ emoji: '💡', text: 'hi', readOnly: true, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(textElement.contentEditable).toBe('false');
  });

  it('emoji button is disabled in readOnly mode', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', text: '', readOnly: true, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(emojiButton.disabled).toBe(true);
  });

  it('emoji button aria-label = addEmojiLabel when emoji is empty', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '', text: '', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(emojiButton.getAttribute('aria-label')).toBe('Add emoji');
  });

  it('emoji button aria-label = emoji char when emoji is set', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { emojiButton } = buildCalloutDOM({ emoji: '💡', text: '', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(emojiButton.getAttribute('aria-label')).toBe('💡');
  });

  it('textElement has the provided HTML text as innerHTML', async () => {
    const { buildCalloutDOM } = await import('../../../../src/tools/callout/dom-builder');
    const { textElement } = buildCalloutDOM({ emoji: '💡', text: '<b>Bold</b>', readOnly: false, placeholder: 'Callout', addEmojiLabel: 'Add emoji' });

    expect(textElement.innerHTML).toBe('<b>Bold</b>');
  });
});
