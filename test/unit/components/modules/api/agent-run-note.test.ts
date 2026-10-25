import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentRun } from '../../../../../src/components/modules/api/agent-run';
import type { AgentRunDeps } from '../../../../../src/components/modules/api/agent-run';
import type { AgentModel, AgentModelResponse, AgentTurn } from '../../../../../types/api';

const LONG = 'Готово: собрал статью «История пиццы: от неаполитанской лепёшки до доставки дроном» с четырьмя фотографиями из Wikimedia и встроенным видео с YouTube.';

const edit: AgentModelResponse = {
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'use-1', name: 'blok_execute', input: { commands: [] } }],
};
const text = (value: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: value }] });

/** A model that answers from `script`, in order, and keeps each request. */
const scripted = (...script: Array<AgentModelResponse | Error>): AgentModel & { requests: Parameters<AgentModel>[0][] } => {
  const requests: Parameters<AgentModel>[0][] = [];

  return Object.assign(async (request: Parameters<AgentModel>[0]): Promise<AgentModelResponse> => {
    requests.push({ ...request, messages: structuredClone(request.messages) });
    const next = script.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }, { requests });
};

const runWith = (model: AgentModel): { result: ReturnType<typeof createAgentRun>['result']; activity: string[]; calls: () => number } => {
  const changed: string[] = [];
  const activity: string[] = [];
  const turn = {
    call: vi.fn(async () => {
      changed.push('b1');

      return { content: '{"ok":true}', isError: false };
    }),
    end: vi.fn(),
  } as unknown as AgentTurn;
  const deps: AgentRunDeps = {
    turn,
    model,
    maxSteps: 5,
    prepare: async () => ({ system: 'system', tools: [{ name: 'blok_execute', description: '', input_schema: { type: 'object' } }] }),
    changed: () => [...changed],
    undoneAll: () => true,
    thinking: () => undefined,
    onActivity: (step) => activity.push(step),
  };

  return { result: createAgentRun('Write an article', deps).result, activity, calls: () => vi.mocked(turn.call).mock.calls.length };
};

describe('agent run: the note after an edit is one short line, written by the model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the model once more for a short note when the note after an edit runs long', async () => {
    const model = scripted(edit, text(LONG), text('Собрал статью об истории пиццы.'));
    const { result } = runWith(model);

    expect((await result).reply).toBe('Собрал статью об истории пиццы.');
    expect(model.requests).toHaveLength(3);

    const rewrite = model.requests[2];

    // The run's own tools: every model adapter takes that shape; some may reject an empty list.
    expect(rewrite.tools).toEqual(model.requests[0].tools);
    expect(rewrite.messages).toEqual([{ role: 'user', content: LONG }]);
  });

  it('keeps a short note as the model wrote it, with no extra call', async () => {
    const model = scripted(edit, text('Added a paragraph about pizza.'));

    expect((await runWith(model).result).reply).toBe('Added a paragraph about pizza.');
    expect(model.requests).toHaveLength(2);
  });

  it('judges only the first line, the one the bar shows after an edit', async () => {
    const model = scripted(edit, text('Wrote a draft.\n\nIt sits at the end of the page, after the closing paragraph about pizza delivery.'));

    expect((await runWith(model).result).reply).toContain('Wrote a draft.');
    expect(model.requests).toHaveLength(2);
  });

  it('counts words in a language written without spaces', async () => {
    const model = scripted(edit, text('我在文章末尾添加了一段关于那不勒斯披萨历史的文字，并配上了四张来自维基共享资源的照片和一个视频。'), text('添加了披萨历史段落。'));

    expect((await runWith(model).result).reply).toBe('添加了披萨历史段落。');
  });

  it('never shortens an answer to a question: nothing was edited', async () => {
    const model = scripted(text(LONG));

    expect((await runWith(model).result).reply).toBe(LONG);
    expect(model.requests).toHaveLength(1);
  });

  it('keeps the long note whole when the rewrite fails: it is never cut', async () => {
    const model = scripted(edit, text(LONG), new Error('overloaded'));
    const outcome = await runWith(model).result;

    expect(outcome.status).toBe('done');
    expect(outcome.reply).toBe(LONG);
  });

  it('keeps the long note when the rewrite comes back long too', async () => {
    const model = scripted(edit, text(LONG), text(LONG));

    expect((await runWith(model).result).reply).toBe(LONG);
  });

  it('keeps the long note when the rewrite answers with a tool call: the call never runs', async () => {
    const model = scripted(edit, text(LONG), { ...edit, content: [{ type: 'tool_use', id: 'use-2', name: 'blok_execute', input: { commands: [] } }] });
    const run = runWith(model);

    expect((await run.result).reply).toBe(LONG);
    expect(run.calls()).toBe(1);
  });
});
