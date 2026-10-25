// @vitest-environment node
/**
 * Law: the MCP model and the Ask AI model are told the same editing rules.
 * Both read SHARED_RULES; each adds only its declared surface-only list.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeGuidance, IN_APP_INTRO, IN_APP_RULES, PAGE_CREATE_RULE, PAGE_RULE, SHARED_RULES } from '../../../src/agent/guidance';
import { buildMcpContracts } from '../../../src/mcp/contract';
import type { Caller } from '../../../src/mcp/dispatcher';
import { MCP_RULES, mcpInstructions } from '../../../src/mcp/instructions';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const caller: Caller = { principal: 'alice', clientName: 'law', scopes: null };
const contract = buildMcpContracts({ pageTitles: 'off' }).stored;

describe('agent guidance parity law', () => {
  it('declares disjoint lists, so a rule lives in exactly one of them', () => {
    const all = [...SHARED_RULES, ...IN_APP_RULES, ...MCP_RULES, PAGE_RULE, PAGE_CREATE_RULE];

    expect(new Set(all).size).toBe(all.length);
    expect(SHARED_RULES.length).toBeGreaterThan(0);
  });

  it('MCP instructions are the contract preamble, the shared rules and the MCP-only rules, nothing else', () => {
    expect(mcpInstructions(contract)).toBe([
      'How to write rich text in Blok:',
      contract.guidance.general.trim(),
      '',
      'Rules for editing a Blok document:',
      ...SHARED_RULES,
      ...MCP_RULES,
    ].join('\n'));
  });

  it('MCP instructions read the preamble from the contract they are given', () => {
    const changed = { ...contract, guidance: { ...contract.guidance, general: 'Custom preamble.' } };

    expect(mcpInstructions(changed)).toContain('Custom preamble.');
    expect(mcpInstructions(changed)).not.toContain(contract.guidance.general.trim());
  });

  it('Ask AI guidance is the contract preamble, the shared rules and the in-app-only rules, nothing else', () => {
    const base = [contract.guidance.general.trim(), '', IN_APP_INTRO, '', ...SHARED_RULES, ...IN_APP_RULES];

    expect(composeGuidance(contract)).toBe(base.join('\n'));
    expect(composeGuidance(contract, { pages: true })).toBe([...base, PAGE_RULE].join('\n'));
  });

  it('both surfaces tell the model how to make a sub-page in the same words, exactly where a page block inserts', () => {
    const creating = buildMcpContracts({ pageTitles: 'page-map', createsPages: true }).stored;
    const base = [creating.guidance.general.trim(), '', IN_APP_INTRO, '', ...SHARED_RULES, ...IN_APP_RULES];

    expect(mcpInstructions(creating)).toBe([
      'How to write rich text in Blok:', creating.guidance.general.trim(), '', 'Rules for editing a Blok document:',
      ...SHARED_RULES, PAGE_CREATE_RULE, ...MCP_RULES,
    ].join('\n'));
    expect(composeGuidance(creating, { pages: true })).toBe([...base, PAGE_CREATE_RULE, PAGE_RULE].join('\n'));
    expect(mcpInstructions(contract)).not.toContain(PAGE_CREATE_RULE);
    expect(composeGuidance(contract, { pages: true })).not.toContain(PAGE_CREATE_RULE);
  });

  it('assembleMcp sends the instructions built from its own stored contract', async () => {
    const mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' } });

    try {
      expect(mcp.instructions).toBe(mcpInstructions(contract));
    } finally {
      await mcp.stop();
    }
  });

  it('no MCP tool description repeats a shared rule', () => {
    const mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' } });

    void mcp.stop();
    const repeated = SHARED_RULES.map(rule => rule.replace(/^- /, ''))
      .filter(rule => mcp.tools.some(tool => tool.description.includes(rule)));

    expect(repeated).toEqual([]);
  });
});

describe('the MCP sub-page rule holds in stored mode', () => {
  let dir: string;
  let mcp: AssembledMcp | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-subpage-'));
    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child' } }] }));
    writeFileSync(join(dir, 'child.json'), JSON.stringify({ blocks: [] }));
  });

  afterEach(async () => {
    await mcp?.stop();
    mcp = undefined;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('blok_open with a page block\'s data.pageId writes inside the sub-page', async () => {
    mcp = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const opened = (await mcp.dispatch('blok_open', { documentId: 'child', write: true }, caller)).structuredContent;
    const outcome = await mcp.dispatch('blok_execute', {
      handle: opened.handle,
      commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: [{ text: 'Inside' }] } } }],
    }, caller);

    expect(opened).toMatchObject({ mode: 'stored', exists: true });
    expect(outcome.structuredContent).toMatchObject({ ok: true });
    expect(readFileSync(join(dir, 'child.json'), 'utf-8')).toContain('Inside');
  });
});
