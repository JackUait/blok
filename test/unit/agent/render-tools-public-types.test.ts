import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { renderAgentTools, type RenderedTool } from '../../../src/agent/render-tools';
import type { AgentAnthropicTool, AgentOpenAITool } from '../../../types';
import { makeContract } from './fixtures/contract';

type AnthropicBranch = Extract<RenderedTool, { input_schema: Record<string, unknown> }>;
type OpenAIBranch = Extract<RenderedTool, { type: 'function'; parameters: Record<string, unknown> }>;

describe('public tool types — test 28', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AgentAnthropicTool equals the anthropic branch', () => {
    expectTypeOf<AgentAnthropicTool>().toEqualTypeOf<AnthropicBranch>();
  });

  it('AgentOpenAITool equals the openai branch', () => {
    expectTypeOf<AgentOpenAITool>().toEqualTypeOf<OpenAIBranch>();
  });

  it('renders exactly the public provider keys with accepted options', () => {
    const anthropicKeys: Array<keyof AgentAnthropicTool> = ['description', 'input_schema', 'name'];
    const anthropicStrictKeys: Array<keyof AgentAnthropicTool> = ['description', 'input_schema', 'name', 'strict'];
    const openaiKeys: Array<keyof AgentOpenAITool> = ['description', 'name', 'parameters', 'strict', 'type'];
    const anthropic = renderAgentTools(makeContract(), { format: 'anthropic', strict: false });

    expect(anthropic.map(tool => ({ name: tool.name, keys: Object.keys(tool).sort() }))).toEqual([
      { name: 'blok_read', keys: anthropicKeys },
      { name: 'blok_describe', keys: anthropicKeys },
      { name: 'blok_execute', keys: anthropicKeys },
    ]);
    anthropic.forEach(tool => expect(tool).not.toHaveProperty('strict'));

    const strictAnthropic = renderAgentTools(makeContract(), { format: 'anthropic', strict: true });

    expect(strictAnthropic.map(tool => ({ name: tool.name, keys: Object.keys(tool).sort() }))).toEqual([
      { name: 'blok_read', keys: anthropicStrictKeys },
      { name: 'blok_describe', keys: anthropicStrictKeys },
      { name: 'blok_execute', keys: anthropicKeys },
    ]);
    expect(strictAnthropic.map(tool => 'strict' in tool ? tool.strict : undefined)).toEqual([
      true,
      true,
      undefined,
    ]);

    const openai = renderAgentTools(makeContract(), { format: 'openai', strict: false });

    expect(openai.map(tool => ({ name: tool.name, keys: Object.keys(tool).sort() }))).toEqual([
      { name: 'blok_read', keys: openaiKeys },
      { name: 'blok_describe', keys: openaiKeys },
      { name: 'blok_execute', keys: openaiKeys },
    ]);
    openai.forEach(tool => expect(tool).toMatchObject({ type: 'function', strict: false }));
  });
});
