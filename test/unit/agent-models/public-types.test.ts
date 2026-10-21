import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as models from '../../../src/agent-models';
import type { AgentModelOptions } from '../../../types/agent-models';

describe('agent-models public surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares every runtime export in types/agent-models.d.ts, and nothing else', () => {
    const declared = [...readFileSync(resolve(__dirname, '../../../types/agent-models.d.ts'), 'utf8')
      .matchAll(/export declare function (\w+)/g)].map((match) => match[1]).sort();

    expect(Object.keys(models).sort()).toEqual(['agentModel']);
    expect(declared).toEqual(Object.keys(models).sort());
  });

  it('declares the same providers that agentModel accepts', () => {
    const union = readFileSync(resolve(__dirname, '../../../types/agent-models.d.ts'), 'utf8')
      .match(/type AgentModel(?:Search)?Provider = [^;]+;/g)?.join(' ') ?? '';
    const declared = [...union.matchAll(/'([\w-]+)'/g)].map((match) => match[1]).sort();
    const accepted = (() => {
      try {
        models.agentModel({ provider: 'none', model: 'm', send: async () => ({}) } as unknown as AgentModelOptions);
      } catch (error) {
        return error instanceof Error ? error.message.replace(/.*one of: |\.$/g, '').split(', ').sort() : [];
      }

      return [];
    })();

    expect(declared).toEqual(accepted);
  });

  it('types webSearch only for providers that run a search', () => {
    // @ts-expect-error deepseek has no webSearch
    const noSearch: AgentModelOptions = { provider: 'deepseek', model: 'm', webSearch: true };
    const withSearch: AgentModelOptions = { provider: 'gemini', model: 'm', webSearch: true };

    expect([noSearch.provider, withSearch.provider]).toEqual(['deepseek', 'gemini']);
  });
});
