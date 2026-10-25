// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, ProtocolErrorCode } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assistantActions } from '../../../src/components/modules/assistant/actions';
import { buildSdkServer } from '../../../src/mcp/sdk-server';
import { AGENT_SKILLS, skillPrompt, skillsFor } from '../../../src/shared/skills';

import type { SkillContext } from '../../../src/shared/skills';

const REQ = { timeout: 5_000, maxTotalTimeout: 5_000 };
const CONTEXTS: SkillContext[] = ['selection', 'caret'];
const t = (key: string): string => `<${key}>`;
const en = JSON.parse(readFileSync(resolve(__dirname, '../../../src/components/i18n/locales/en.json'), 'utf8')) as Record<string, string>;

const pairs = AGENT_SKILLS.flatMap(skill => CONTEXTS
  .filter(context => skill.prompts[context] !== undefined)
  .map(context => ({ id: skill.id, context, prompt: skillPrompt(skill, context) ?? '' })));

const withClient = async (verify: (client: Client) => Promise<void>): Promise<void> => {
  const server = buildSdkServer({
    tools: [],
    instructions: '',
    dispatch: async () => ({ structuredContent: {}, isError: false }),
    caller: name => ({ principal: 'local', clientName: name, scopes: null }),
    version: '0.0.0-test',
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'skills-law', version: '1' });

  await server.connect(serverSide);
  await client.connect(clientSide, REQ);
  try {
    await verify(client);
  } finally {
    await client.close();
    await server.close();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Ask AI skills law: Ask AI and MCP offer the same skills', () => {
  it('finds every skill and both contexts (non-vacuity)', () => {
    expect(AGENT_SKILLS.length).toBeGreaterThanOrEqual(9);
    expect(pairs.filter(pair => pair.context === 'selection').length).toBeGreaterThan(0);
    expect(pairs.filter(pair => pair.context === 'caret').length).toBeGreaterThan(0);
  });

  it.each(AGENT_SKILLS.map(skill => [skill.id, skill.label]))('%s has the en locale label', (id, label) => {
    expect(en[`assistant.action.${id}`]).toBe(label);
  });

  it.each(CONTEXTS)('Ask AI shows exactly the shared %s skills, with the shared prompts', context => {
    expect(assistantActions(context, t).map(({ label, prompt }) => ({ label, prompt })))
      .toEqual(skillsFor(context).map(({ skill, prompt }) => ({ label: t(`assistant.action.${skill.id}`), prompt })));
  });

  it.each(pairs)('Ask AI shows $id at a $context', ({ id, context, prompt }) => {
    expect(assistantActions(context, t)).toContainEqual(expect.objectContaining({ label: t(`assistant.action.${id}`), prompt }));
  });

  it('MCP lists exactly the shared skills as prompts, named by id with the English label', async () => {
    await withClient(async client => {
      const { prompts } = await client.listPrompts(undefined, REQ);

      expect(prompts.map(({ name, description }) => ({ name, description })))
        .toEqual(AGENT_SKILLS.map(({ id, label }) => ({ name: id, description: label })));
    });
  });

  it.each(pairs)('MCP prompt $id for a $context carries the shared prompt', async ({ id, context, prompt }) => {
    await withClient(async client => {
      const args = context === 'selection' ? { selection: 'Teh cat sat.', blockId: 'b1' } : { blockId: 'b1' };
      const result = await client.getPrompt({ name: id, arguments: { documentId: 'doc-1', ...args } }, REQ);
      const text = result.messages.map(message => (message.content.type === 'text' ? message.content.text : '')).join('\n');

      expect(text).toContain(prompt);
      expect(text).toContain('blok_open');
      expect(text).toContain('blok_execute');
      expect(text).toContain('"doc-1"');
      if (context === 'selection') {
        expect(text).toContain(JSON.stringify('Teh cat sat.'));
      }
    });
  });

  it('MCP refuses a selection skill without a selection, and an unknown prompt', async () => {
    await withClient(async client => {
      await expect(client.getPrompt({ name: 'improve', arguments: {} }, REQ)).rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
      await expect(client.getPrompt({ name: 'nope', arguments: {} }, REQ)).rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
    });
  });
});
