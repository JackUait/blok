// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools } from '../../../../../src/agent/render-tools';
import { Core } from '../../../../../src/components/core';
import { wrapLegacyInlineTool } from '../../../../../src/components/inline-tools/wrap-legacy-inline-tool';
import { createEditorAgentSession, liveContractSource } from '../../../../../src/components/modules/agent/editor-session';
import { Bold, Marker } from '../../../../../src/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';

import type { AgentSession } from '../../../../../types/agent';

class Kbd {
  public static isInline = true;
  public static title = 'Keyboard';
  public static sanitize = { kbd: { 'data-key': true } };
  public render(): HTMLElement {
    return document.createElement('button');
  }
}

/** An Editor.js-era tool: the class on its span is how it finds its own marks. */
class LegacySpark {
  public static isInline = true;
  public static title = 'Spark';
  public static sanitize = { span: { class: 'cdx-spark' } };
  public render(): HTMLElement {
    return document.createElement('button');
  }
}

const TEXT = [
  { text: 'Press ' },
  { text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl' } } },
  { text: ' and ' },
  { text: 'spark', marks: { 'tag:span': { class: 'cdx-spark' } } },
  { text: ' now' },
];

const sessions: AgentSession[] = [];

const boot = async (): Promise<{ core: Core; session: AgentSession }> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    tools: {
      paragraph: { class: Paragraph },
      bold: { class: Bold },
      marker: { class: Marker },
      kbd: { class: Kbd },
      spark: { class: wrapLegacyInlineTool(LegacySpark) },
    },
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: TEXT } }] },
  });

  await core.isReady;
  const session = createEditorAgentSession(core.moduleInstances, { id: 'a', name: 'Agent', kind: 'agent' });

  sessions.push(session);

  return { core, session };
};

const textOf = async (session: AgentSession): Promise<unknown> =>
  (await session.read({ ids: ['p'] })).blocks.find(block => block.id === 'p')?.data?.text;

// Booting a real editor is slow on a busy machine.
describe('custom inline tools in the editor agent', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessions.splice(0).forEach(session => session.close());
    document.body.innerHTML = '';
  });

  it('keeps both custom marks when the agent bolds another word', async () => {
    const { session } = await boot();
    const result = await session.execute({ commands: [
      { name: 'text.format', args: { id: 'p', range: { find: 'now' }, set: { bold: true } } },
    ] });

    expect(await textOf(session)).toEqual([...TEXT.slice(0, 4), { text: ' ' }, { text: 'now', marks: { bold: true } }]);
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it('drops an attribute the custom tool does not declare when the agent writes its mark', async () => {
    const { session } = await boot();

    await session.execute({ commands: [
      { name: 'text.format', args: { id: 'p', range: { find: 'now' }, set: { 'tag:kbd': { 'data-key': 'n', 'data-other': 'x' } } } },
    ] });

    expect(await textOf(session)).toEqual([...TEXT.slice(0, 4), { text: ' ' }, { text: 'now', marks: { 'tag:kbd': { 'data-key': 'n' } } }]);
  });

  it('lists each custom mark, with its attributes, in the rendered tools', async () => {
    const { core } = await boot();
    const contract = liveContractSource(core.moduleInstances).contract();
    const rendered = JSON.stringify(renderAgentTools(contract, { format: 'anthropic', schema: 'mixed' }));

    expect(rendered).toContain('"tag:kbd"');
    expect(rendered).toContain('"data-key"');
    expect(rendered).toContain('"tag:span"');
    expect(rendered).toContain('cdx-spark');
  });

  it('answers blok_describe for an inline tool by name', async () => {
    const { session } = await boot();

    expect(session.describe({ tool: 'kbd' })).toMatchObject({ inlineTool: { name: 'kbd', effect: { mark: 'tag:kbd' } } });
    expect(session.describe({ tool: 'bold' })).toMatchObject({ inlineTool: { name: 'bold', effect: { mark: 'bold' } } });
    expect(session.describe({ tool: 'marker' })).toMatchObject({ inlineTool: { name: 'marker' } });
  });
});
