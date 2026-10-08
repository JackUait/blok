// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools, type RenderOptions } from '../../../src/agent/render-tools';
import { deepFreeze, makeContract } from './fixtures/contract';

describe('renderAgentTools Node purity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const formats: Array<RenderOptions['format']> = ['anthropic', 'openai', 'mcp'];
  const modes: Array<RenderOptions['schema']> = ['envelope', 'full'];

  it.each(formats)('%s runs every schema mode without DOM globals', format => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');

    modes.forEach(mode => {
      const tools = renderAgentTools(deepFreeze(makeContract()), { format, schema: mode, handle: true });

      expect(tools).toHaveLength(3);
      expect(() => JSON.stringify(tools)).not.toThrow();
    });
  });
});
