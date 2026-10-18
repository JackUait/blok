/**
 * Law: tool definitions rendered from the LIVE contract of every built-in
 * tool follow the provider rules Blok can confirm, and every command the
 * model is offered is one the session reports as available.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { allTools } from '../../../src/full';
import { TOOL_NAME_PATTERN } from '../../../src/agent/render-tools';
import type { Agent, AgentToolsOptions } from '../../../types';

type Schema = Record<string, unknown>;

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent }

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (schema: unknown, key: string): Schema => {
  const value = isSchema(schema) ? schema[key] : undefined;

  if (!isSchema(value)) {
    throw new Error(`Expected an object at "${key}".`);
  }

  return value;
};

const boot = async (): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({ holder, tools: allTools }) as unknown as TestEditor;

  await editor.isReady;

  return editor;
};

const inputOf = (tool: Schema): Schema => field(tool, 'input_schema' in tool ? 'input_schema' : 'parameters');

const asSchemas = (tools: unknown[]): Schema[] => tools.filter(isSchema);

// tools() is overloaded per format, so a union format must be narrowed first.
const renderTools = (agent: Agent, options: Omit<AgentToolsOptions, 'format'> & { format: 'anthropic' | 'openai' }): Promise<unknown[]> =>
  options.format === 'anthropic'
    ? agent.tools({ ...options, format: 'anthropic' })
    : agent.tools({ ...options, format: 'openai' });

// OpenAI treats a missing `strict` as strict, so the renderer writes `strict: false` there.
const expectNotStrict = (tool: Schema, format: 'anthropic' | 'openai'): void => {
  if (format === 'openai') {
    expect(tool).toHaveProperty('strict', false);
  } else {
    expect(tool).not.toHaveProperty('strict');
  }
};

describe('agent tool definition law', () => {
  const state: { editor: TestEditor | null } = { editor: null };

  const editor = (): TestEditor => {
    if (state.editor === null) {
      throw new Error('The editor did not boot.');
    }

    return state.editor;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    state.editor = await boot();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    state.editor?.destroy();
    state.editor = null;
    document.body.innerHTML = '';
  });

  it.each(['anthropic', 'openai'] as const)('%s envelope: names, root objects, blok_execute not strict', async (format) => {
    const tools = asSchemas(await renderTools(editor().agent, { format, strict: false }));

    expect(tools.map((tool) => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    tools.forEach((tool) => {
      const root = inputOf(tool);

      expect(String(tool.name)).toMatch(TOOL_NAME_PATTERN);
      expect(root.type).toBe('object');
      expect(root).not.toHaveProperty('anyOf');
      expect(root).not.toHaveProperty('oneOf');
    });
    expectNotStrict(tools[2], format);
  });

  it.each(['anthropic', 'openai'] as const)('%s full: renders within limits or throws a named renderer error', async (format) => {
    try {
      const tools = asSchemas(await renderTools(editor().agent, { format, schema: 'full', strict: true }));

      expectNotStrict(tools[2], format);
    } catch (error) {
      expect(error).toMatchObject({ name: expect.stringMatching(/^AgentTools(TooLarge|Strict)Error$/) as unknown });
    }
  });

  it('every command the enum offers is described as available', async () => {
    const tools = asSchemas(await editor().agent.tools({ format: 'anthropic', schema: 'envelope' }));
    const nameSchema = field(field(field(field(inputOf(tools[2]), 'properties'), 'commands'), 'items'), 'properties');
    const enumValues: unknown = field(nameSchema, 'name').enum;
    const names = Array.isArray(enumValues) ? enumValues.filter((name): name is string => typeof name === 'string') : [];
    const turn = editor().agent.begin({ agent: { id: 'law', name: 'Law' } });

    const unavailable = names.filter((name) => {
      const slice = turn.describe({ command: name });

      return !('command' in slice) || !slice.command.available;
    });

    turn.end();
    expect(unavailable).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});
