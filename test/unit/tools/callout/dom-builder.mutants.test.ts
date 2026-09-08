import { describe, it, expect } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { buildCalloutDOM, calloutEmojiButtonLabel } from '../../../../src/tools/callout/dom-builder';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

const build = (overrides: Partial<Parameters<typeof buildCalloutDOM>[0]> = {}): ReturnType<typeof buildCalloutDOM> =>
  buildCalloutDOM({
    emoji: '💡',
    readOnly: false,
    addEmojiLabel: 'Add icon',
    editEmojiLabel: 'Change icon',
    ...overrides,
  });

describe('callout DOM builder mutants', () => {
  it('marks the wrapper as a callout and gives the trigger a real button type', () => {
    const refs = build();

    expect(refs.wrapper.getAttribute(DATA_ATTR.tool)).toBe('callout');
    // A blanked type reflects back as submit, so the attribute is the observable.
    expect(refs.emojiButton.getAttribute('type')).toBe('button');
  });

  it('puts the emoji in a face span inside the button', () => {
    const refs = build();

    expect(refs.emojiFace.textContent).toBe('💡');
    expect(refs.emojiFace.getAttribute('data-blok-testid')).toBe('callout-emoji-face');
    expect(refs.emojiButton.getAttribute('data-blok-testid')).toBe('callout-emoji-btn');
    expect(refs.emojiFace.parentElement).toBe(refs.emojiButton);
  });

  it('leaves the face empty when there is no emoji', () => {
    expect(build({ emoji: '' }).emojiFace.textContent).toBe('');
  });

  it('disables the trigger only in read-only mode', () => {
    expect(build().emojiButton.disabled).toBe(false);
    expect(build({ readOnly: true }).emojiButton.disabled).toBe(true);
  });

  it('stamps the child container with every empty marker it needs', () => {
    const { childContainer } = build();

    expect(childContainer.getAttribute(TOGGLE_ATTR.toggleChildren)).toBe('');
    expect(childContainer.getAttribute(DATA_ATTR.nestedBlocks)).toBe('');
    expect(childContainer.getAttribute('data-blok-child-toolbar')).toBe('');
    expect(childContainer.getAttribute('data-blok-mutation-free')).toBe('true');
  });

  // The trigger is named by what activating it does; the emoji trails as
  // detail, so it never announces as just the glyph.
  it('names the trigger by its action, with the emoji trailing', () => {
    expect(calloutEmojiButtonLabel('', 'Add icon', 'Change icon')).toBe('Add icon');
    expect(calloutEmojiButtonLabel('💡', 'Add icon', 'Change icon')).toBe('Change icon 💡');
    expect(build().emojiButton.getAttribute('aria-label')).toBe('Change icon 💡');
  });

  it('falls back to the add label when no edit label was given', () => {
    expect(build({ editEmojiLabel: undefined }).emojiButton.getAttribute('aria-label')).toBe('Add icon 💡');
  });
});
