import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ASSISTANT_CSS = readFileSync(resolve(__dirname, '../../../src/styles/assistant.css'), 'utf8');

/** A list-like holder: a marker, an editable field, and a nested child block with its own field. */
const holderWithChild = (): { holder: HTMLElement; content: HTMLElement; marker: HTMLElement; input: HTMLElement; childInput: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const marker = document.createElement('span');
  const input = document.createElement('div');
  const child = document.createElement('div');
  const childContent = document.createElement('div');
  const childInput = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  content.setAttribute('data-blok-element-content', '');
  input.setAttribute('contenteditable', 'true');
  child.setAttribute('data-blok-element', '');
  childContent.setAttribute('data-blok-element-content', '');
  childInput.setAttribute('contenteditable', 'true');
  childContent.appendChild(childInput);
  child.appendChild(childContent);
  content.append(marker, input, child);
  holder.appendChild(content);
  document.body.appendChild(holder);

  return { holder, content, marker, input, childInput };
};

describe('Ask AI rewrite hiding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const style = document.createElement('style');

    style.textContent = ASSISTANT_CSS;
    document.head.appendChild(style);
  });

  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('hides the rewritten block\'s text without taking it out of layout', () => {
    const { holder, input } = holderWithChild();

    expect(getComputedStyle(input).visibility).not.toBe('hidden');
    holder.setAttribute('data-blok-ai-rewriting', '');

    expect(getComputedStyle(input).visibility).toBe('hidden');
    expect(getComputedStyle(input).display).not.toBe('none');
  });

  it('keeps the marker and the rest of the block visible', () => {
    const { holder, content, marker } = holderWithChild();

    holder.setAttribute('data-blok-ai-rewriting', '');

    expect(getComputedStyle(marker).visibility).not.toBe('hidden');
    expect(getComputedStyle(content).visibility).not.toBe('hidden');
  });

  it('keeps a nested child block\'s text visible', () => {
    const { holder, childInput } = holderWithChild();

    holder.setAttribute('data-blok-ai-rewriting', '');

    expect(getComputedStyle(childInput).visibility).not.toBe('hidden');
  });
});
