import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ASSISTANT_CSS = readFileSync(resolve(__dirname, '../../../src/styles/assistant.css'), 'utf8');

/** A holder with its own content column, holding a nested child block. */
const holderWithChild = (): { holder: HTMLElement; content: HTMLElement; childContent: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const child = document.createElement('div');
  const childContent = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  content.setAttribute('data-blok-element-content', '');
  child.setAttribute('data-blok-element', '');
  childContent.setAttribute('data-blok-element-content', '');
  child.appendChild(childContent);
  content.appendChild(child);
  holder.appendChild(content);
  document.body.appendChild(holder);

  return { holder, content, childContent };
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

  it('hides the rewritten block\'s content without taking it out of layout', () => {
    const { holder, content } = holderWithChild();

    expect(getComputedStyle(content).visibility).not.toBe('hidden');
    holder.setAttribute('data-blok-ai-rewriting', '');

    expect(getComputedStyle(content).visibility).toBe('hidden');
    expect(getComputedStyle(content).display).not.toBe('none');
  });

  it('keeps a nested child block visible', () => {
    const { holder, childContent } = holderWithChild();

    holder.setAttribute('data-blok-ai-rewriting', '');

    expect(getComputedStyle(childContent).visibility).toBe('visible');
  });
});
