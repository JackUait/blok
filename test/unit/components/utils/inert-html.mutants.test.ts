/**
 * Mutation-hardening tests for `src/components/utils/inert-html.ts`.
 *
 * The one live mutant replaced the `createHTMLDocument('')` argument with a
 * non-empty string, which is only visible through the parsed wrapper's owning
 * document, so the test reads that document's title.
 *
 * No equivalent survivors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { parseUntrustedHtml } from '../../../../src/components/utils/inert-html';

describe('parseUntrustedHtml — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses into a document created with an empty title', () => {
    const wrapper = parseUntrustedHtml('<p>hi</p>');
    const owner = wrapper.ownerDocument;

    expect(owner.title).toBe('');
    expect(owner).not.toBe(document);
    expect(owner.defaultView).toBeNull();
  });

  it('reuses the same inert document across calls', () => {
    const first = parseUntrustedHtml('<p>one</p>');
    const second = parseUntrustedHtml('<p>two</p>');

    expect(second.ownerDocument).toBe(first.ownerDocument);
    expect(second.ownerDocument.title).toBe('');
  });
});
