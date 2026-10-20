import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geminiModel } from '../../../src/agent-models/gemini';
import { openaiModel } from '../../../src/agent-models/openai';
import { openaiCompatibleModel } from '../../../src/agent-models/openai-compatible';
import {
  errorOf, merge, parseArguments, providerBlock, rawTurn, toolNames, withLevel, type AdapterOptions,
} from '../../../src/agent-models/shared';
import type { AgentModelRequest } from '../../../types/api';

const options: AdapterOptions = { model: 'm', send: async () => ({}) };
const request = (thinking?: AgentModelRequest['thinking']): AgentModelRequest => ({
  system: 's', messages: [], tools: [], signal: new AbortController().signal, ...(thinking === undefined ? {} : { thinking }),
});
const defaults = {
  off: { effort: 'none' }, low: { effort: 'low' }, medium: { effort: 'medium' },
  high: { effort: 'high' }, xhigh: { effort: 'xhigh' }, max: { effort: 'max' },
};

describe('adapter helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deep-merges objects and replaces arrays and scalars', () => {
    expect(merge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2] }, d: 2 })).toEqual({ a: { b: 1, c: [2] }, d: 2 });
  });

  it('merges a fragment as a copy, not by reference', () => {
    const fragment = { reasoning: { effort: 'low' } };

    expect(merge({}, fragment).reasoning).not.toBe(fragment.reasoning);
  });

  it('adds the default fragment for the level, a host override replaces it, and no level adds nothing', () => {
    expect(withLevel({ x: 1 }, request('low'), defaults, options)).toEqual({ x: 1, effort: 'low' });
    expect(withLevel({ x: 1 }, request('off'), defaults, { ...options, levels: { off: { mode: 'between' } } }))
      .toEqual({ x: 1, mode: 'between' });
    expect(withLevel({ x: 1 }, request(), defaults, options)).toEqual({ x: 1 });
  });

  it('finds the raw turn of its own format only', () => {
    const content = [{ type: 'text', text: 'hi' }, providerBlock('a', ['raw-a'])];

    expect(rawTurn(content, 'a')).toEqual(['raw-a']);
    expect(rawTurn(content, 'b')).toBeUndefined();
    expect(rawTurn('plain', 'a')).toBeUndefined();
  });

  it('parses JSON arguments and keeps broken ones for the tool to reject', () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseArguments('{"a":')).toEqual({ invalidJson: '{"a":' });
    expect(parseArguments({ a: 1 })).toEqual({ a: 1 });
    expect(parseArguments(undefined)).toEqual({});
    expect(parseArguments('')).toEqual({});
    expect(parseArguments('  ')).toEqual({});
  });

  it('maps tool_use ids to names across the history', () => {
    expect(toolNames([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'blok_read', input: {} }] },
    ])).toEqual(new Map([['c1', 'blok_read']]));
  });

  it('reads provider error bodies', () => {
    expect(errorOf({ error: { message: 'bad key' } }, 'OpenAI')?.message).toBe('OpenAI: bad key');
    expect(errorOf({ error: 'down' }, 'Gemini')?.message).toBe('Gemini: down');
    expect(errorOf({ output: [] }, 'OpenAI')).toBeNull();
  });

  it('every adapter needs send or stream when it is made', () => {
    expect(() => openaiModel({ model: 'm' })).toThrow(new TypeError('OpenAI: pass send or stream.'));
    expect(() => openaiCompatibleModel({ model: 'm' })).toThrow(new TypeError('OpenAI-compatible: pass send or stream.'));
    expect(() => geminiModel({ model: 'm' })).toThrow(new TypeError('Gemini: pass send or stream.'));
  });
});
