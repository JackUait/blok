import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geminiModel } from '../../../src/agent-models/gemini';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage } from '../../../types/api';

const fakeSend = (...replies: unknown[]): { send: (body: Record<string, unknown>) => Promise<unknown>; bodies: Record<string, unknown>[] } => {
  const bodies: Record<string, unknown>[] = [];

  return {
    bodies,
    send: async (body) => {
      bodies.push(structuredClone(body));

      return replies.shift();
    },
  };
};

const run = (model: ReturnType<typeof geminiModel>, messages: AgentModelMessage[], thinking?: 'off' | 'high') => runAssistantLoop({
  model, system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  messages, call: async () => ({ content: '{"ok":true}', isError: false }),
  signal: new AbortController().signal, maxSteps: 5, ...(thinking === undefined ? {} : { thinking }),
});

describe('geminiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const candidate = (parts: unknown[], finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] });
  const signedCall = { functionCall: { id: 'c1', name: 'blok_read', args: {} }, thoughtSignature: 'sig' };

  it('replays model parts with their thought signature, then one user content of responses', async () => {
    const { send, bodies } = fakeSend(candidate([{ text: 'plan', thought: true }, signedCall]), candidate([{ text: 'Done.' }]));

    expect(await run(geminiModel({ model: 'gemini-3.8-flash', send }), [{ role: 'user', content: 'Go' }]))
      .toEqual({ status: 'done', reply: 'Done.' });
    expect(bodies[1].contents).toEqual([
      { role: 'user', parts: [{ text: 'Go' }] },
      { role: 'model', parts: [{ text: 'plan', thought: true }, signedCall] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
    expect(bodies[0]).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'Go' }] }],
      tools: [{ functionDeclarations: [{ name: 'blok_read', description: 'd', parametersJsonSchema: { type: 'object' } }] }],
      generationConfig: { maxOutputTokens: 16000 },
    });
  });

  it('invents a stable id when the call has none, and the response carries it', async () => {
    const { send, bodies } = fakeSend(candidate([{ functionCall: { name: 'blok_read', args: {} } }]), candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);

    const responses = (bodies[1].contents as Array<{ parts: Array<{ functionResponse?: { id: string; name: string } }> }>)[2].parts;

    expect(responses[0].functionResponse).toEqual({ id: 'call-1-0', name: 'blok_read', response: { result: '{"ok":true}' } });
  });

  it('treats an empty id as missing', async () => {
    const { send, bodies } = fakeSend(candidate([{ functionCall: { id: '', name: 'blok_read', args: {} } }]), candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect((bodies[1].contents as unknown[]).slice(1)).toEqual([
      { role: 'model', parts: [{ functionCall: { id: 'call-1-0', name: 'blok_read', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call-1-0', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
  });

  it('sends a failed tool result under error', async () => {
    const { send, bodies } = fakeSend(candidate([signedCall]), candidate([{ text: 'ok' }]));

    await runAssistantLoop({
      model: geminiModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async () => ({ content: '{"ok":false}', isError: true }), signal: new AbortController().signal, maxSteps: 5,
    });
    expect((bodies[1].contents as Array<{ parts: unknown[] }>)[2].parts[0])
      .toEqual({ functionResponse: { id: 'c1', name: 'blok_read', response: { error: '{"ok":false}' } } });
  });

  it('maps stop states: MAX_TOKENS, SAFETY, a blocked prompt', async () => {
    const max = fakeSend(candidate([{ text: 'cut' }], 'MAX_TOKENS'));
    const safety = fakeSend(candidate([], 'SAFETY'));
    const blocked = fakeSend({ promptFeedback: { blockReason: 'SAFETY' } });

    expect((await run(geminiModel({ model: 'm', send: max.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(geminiModel({ model: 'm', send: safety.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(geminiModel({ model: 'm', send: blocked.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('maps levels to thinkingLevel inside generationConfig, keeping maxOutputTokens', async () => {
    const end = candidate([{ text: 'ok' }]);
    const { send, bodies } = fakeSend(end, end);

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.generationConfig)).toEqual([
      { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
      { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'HIGH' } },
    ]);
  });

  it('passes the model id to send, since Gemini puts it in the URL', async () => {
    const seen: unknown[] = [];

    await run(geminiModel({ model: 'gemini-3.8-flash', send: async (_body, context) => {
      seen.push(context.model);

      return candidate([{ text: 'ok' }]);
    } }), [{ role: 'user', content: 'a' }]);
    expect(seen).toEqual(['gemini-3.8-flash']);
  });

  it('a send that edits the replayed parts leaves the stored turn alone', async () => {
    const replies: unknown[] = [candidate([signedCall]), candidate([signedCall]), candidate([{ text: 'ok' }])];
    const bodies: Record<string, unknown>[] = [];
    const send = async (body: Record<string, unknown>): Promise<unknown> => {
      bodies.push(structuredClone(body));
      const turn: unknown = Array.isArray(body.contents) ? body.contents[1] : undefined;

      if (typeof turn === 'object' && turn !== null && 'parts' in turn && Array.isArray(turn.parts)) {
        Reflect.set(turn.parts, 0, { text: 'edited' });
      }

      return replies.shift();
    };

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect((bodies[2].contents as unknown[])[1]).toEqual({ role: 'model', parts: [signedCall] });
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { code: 400, message: 'API key not valid' } });

    expect(await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini: API key not valid' });
  });
  it('fails the run on a stop reason it does not handle', async () => {
    const missing = fakeSend({ candidates: [{ finishReason: 'MISSING_THOUGHT_SIGNATURE' }] });
    const tooMany = fakeSend({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'TOO_MANY_TOOL_CALLS' }] });

    expect(await run(geminiModel({ model: 'm', send: missing.send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini stopped: MISSING_THOUGHT_SIGNATURE' });
    expect(await run(geminiModel({ model: 'm', send: tooMany.send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini stopped: TOO_MANY_TOOL_CALLS' });
  });

  it('drops another adapter\'s provider blocks and rebuilds the turn', async () => {
    const { send, bodies } = fakeSend(candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [
        { type: 'text', text: 'b' },
        { type: 'tool_use', id: 'u1', name: 'blok_read', input: { x: 1 } },
        { type: 'provider', format: 'anthropic', raw: [{ type: 'thinking', signature: 'foreign' }] },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: '{"ok":true}' }] },
    ]);
    expect((bodies[0].contents as unknown[]).slice(1)).toEqual([
      { role: 'model', parts: [{ text: 'b' }, { functionCall: { id: 'u1', name: 'blok_read', args: { x: 1 } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'u1', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
  });
});
