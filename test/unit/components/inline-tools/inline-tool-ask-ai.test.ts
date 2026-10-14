import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskAiInlineTool } from '../../../../src/components/inline-tools/inline-tool-ask-ai';
import type { API } from '../../../../types';

const apiWith = (): { api: API; openAssistant: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } => {
  const openAssistant = vi.fn();
  const close = vi.fn();
  const api = { agent: { openAssistant }, inlineToolbar: { close } } as unknown as API;

  return { api, openAssistant, close };
};

describe('AskAiInlineTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the assistant bar and closes the inline toolbar when activated', () => {
    const { api, openAssistant, close } = apiWith();
    const item = new AskAiInlineTool({ api }).render();

    expect('onActivate' in item).toBe(true);
    if ('onActivate' in item && typeof item.onActivate === 'function') {
      item.onActivate(item, undefined);
    }

    expect(openAssistant).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    // The bar must read the selection before the toolbar closes and drops it.
    expect(openAssistant.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });

  // An isActive flag would make the toolbar expose it as a checkbox; it is an action.
  it('is a plain action, not a toggle', () => {
    const item = new AskAiInlineTool({ api: apiWith().api }).render();

    expect('isActive' in item).toBe(false);
    expect('toggle' in item).toBe(false);
  });
});
