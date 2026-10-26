// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContracts } from '../../../src/mcp/contract';
import { createHeadlessAgentSetup, createHeadlessPorts } from '../../../src/view/agent-runtime';

import type { AgentContract, BlokCustomToolsFile, ManifestOverrides, SnapshotBlockStatics } from '../../../types/tool-manifest';
import type { HostService } from '../../../types/tools/tool-description';

const customStatics: SnapshotBlockStatics = {
  toolbox: [],
  richTextFields: [],
  acceptsChildren: false,
  ownsChildren: false,
  isLayout: false,
  deletesChildren: false,
  selfPlacesChildren: false,
  restrictedInTableCell: false,
  conversion: {},
  convertible: { import: false, export: false },
  hasPrepareInsert: false,
};

const customTools: BlokCustomToolsFile = {
  formatVersion: 1,
  blocks: [{
    name: 'note_x',
    description: { summary: 'A note.', data: { type: 'object' } },
    statics: { ...customStatics, richTextFields: ['body'] },
    sanitize: { body: { strong: true } },
  }, {
    name: 'empty_note_x',
    description: { summary: 'A note without rich text.', data: { type: 'object' } },
    statics: customStatics,
  }],
};

const command = (contract: AgentContract, name: string) =>
  contract.commands.find(entry => entry.name === name);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildMcpContracts', () => {
  it('makes session history available in the stored contract', () => {
    const { stored } = buildMcpContracts({ pageTitles: 'off' });

    for (const name of ['history.undo', 'history.redo']) {
      expect(command(stored, name)).toMatchObject({ available: true });
      expect(command(stored, name)?.unavailableReason).toBeUndefined();
    }
  });

  it('makes session history available in the live contract too', () => {
    const { live } = buildMcpContracts({ pageTitles: 'off' });

    for (const name of ['history.undo', 'history.redo']) {
      expect(command(live, name)).toMatchObject({ available: true });
      expect(command(live, name)?.unavailableReason).toBeUndefined();
    }
  });

  it('requires the page-map service for page.rename in both contracts', () => {
    const off = buildMcpContracts({ pageTitles: 'off' });
    const on = buildMcpContracts({ pageTitles: 'page-map' });

    for (const contract of [off.stored, off.live]) {
      expect(command(contract, 'page.rename'))
        .toMatchObject({ available: false, unavailableReason: 'service' });
    }
    for (const contract of [on.stored, on.live]) {
      expect(command(contract, 'page.rename')).toMatchObject({ available: true });
      expect(command(contract, 'page.rename')?.unavailableReason).toBeUndefined();
    }
  });

  it('removes table.insertRows when that declared custom action is hidden', () => {
    const manifest: BlokCustomToolsFile = {
      formatVersion: 1,
      blocks: [{
        name: 'table',
        description: {
          summary: 'A custom grid.',
          data: { type: 'object' },
          actions: [{
            name: 'insertRows',
            summary: 'Insert rows.',
            target: 'block',
            args: {
              type: 'object',
              required: ['at'],
              properties: { at: { type: 'integer', minimum: 0 } },
            },
          }],
        },
        statics: { ...customStatics, acceptsChildren: true },
      }],
    };
    const hidden = buildMcpContracts({
      pageTitles: 'off',
      manifest,
      overrides: { table: { hiddenActions: ['insertRows'] } },
    });
    const visible = buildMcpContracts({ pageTitles: 'off', manifest });

    for (const contract of [hidden.stored, hidden.live]) {
      expect(command(contract, 'table.insertRows')).toBeUndefined();
    }
    for (const contract of [visible.stored, visible.live]) {
      expect(command(contract, 'table.insertRows')).toMatchObject({
        name: 'table.insertRows',
        source: { tool: 'table', target: 'block' },
      });
    }
  });

  it('applies hiddenActions to a built-in action in both contracts', () => {
    const hidden = buildMcpContracts({
      pageTitles: 'page-map',
      overrides: { page: { hiddenActions: ['rename'] } },
    });
    const visible = buildMcpContracts({ pageTitles: 'page-map' });

    for (const contract of [hidden.stored, hidden.live]) {
      expect(command(contract, 'page.rename')).toBeUndefined();
    }
    for (const contract of [visible.stored, visible.live]) {
      expect(command(contract, 'page.rename')).toMatchObject({ available: true });
    }
  });

  it('removes hidden tools from both manifests without removing unrelated tools', () => {
    const hidden = buildMcpContracts({ pageTitles: 'off', overrides: { embed: { hidden: true } } });
    const visible = buildMcpContracts({ pageTitles: 'off' });

    for (const contract of [hidden.stored, hidden.live]) {
      expect(contract.manifest.blocks.find(entry => entry.name === 'embed')).toBeUndefined();
      expect(contract.manifest.blocks.find(entry => entry.name === 'paragraph')).toBeDefined();
    }
    for (const contract of [visible.stored, visible.live]) {
      expect(contract.manifest.blocks.find(entry => entry.name === 'embed')).toBeDefined();
    }
  });

  it('uses manifest rich text fields, including empty lists, before the config fallback', () => {
    const contracts = buildMcpContracts({
      pageTitles: 'off',
      manifest: customTools,
      richTextFields: {
        paragraph: ['ignored'],
        table: ['ignored'],
        note_x: ['ignored'],
        empty_note_x: ['ignored'],
        legacy_note: ['body'],
      },
    });

    expect(contracts.richTextFieldsFor('paragraph')).toEqual(['text']);
    expect(contracts.richTextFieldsFor('table')).toEqual([]);
    expect(contracts.richTextFieldsFor('note_x')).toEqual(['body']);
    expect(contracts.richTextFieldsFor('empty_note_x')).toEqual([]);
    expect(contracts.richTextFieldsFor('legacy_note')).toEqual(['body']);
    expect(contracts.richTextFieldsFor('unknown_type')).toEqual([]);
  });

  it('returns built-in runtimes together with the custom tool sanitizer', () => {
    const custom = buildMcpContracts({ pageTitles: 'off', manifest: customTools });
    const plain = buildMcpContracts({ pageTitles: 'off' });

    expect(custom.runtimes.get('note_x')).toMatchObject({
      name: 'note_x',
      sanitize: { body: { strong: true } },
      actions: {},
    });
    expect(custom.runtimes.has('paragraph')).toBe(true);
    expect(plain.runtimes.has('note_x')).toBe(false);
  });

  it('changes both revisions for custom tools and keeps identical inputs stable', () => {
    const plain = buildMcpContracts({ pageTitles: 'off' });
    const custom = buildMcpContracts({ pageTitles: 'off', manifest: customTools });
    const repeated = buildMcpContracts({ pageTitles: 'off', manifest: structuredClone(customTools) });

    expect(custom.stored.revision).not.toBe(plain.stored.revision);
    expect(custom.live.revision).not.toBe(plain.live.revision);
    expect(repeated.stored.revision).toBe(custom.stored.revision);
    expect(repeated.live.revision).toBe(custom.live.revision);
  });

  it('composes the current headless setup for both runtimes with the same custom tools, overrides and services', () => {
    const overrides: ManifestOverrides = {
      paragraph: { guidance: 'Keep paragraphs brief.' },
      embed: { hidden: true },
      page: { hiddenActions: ['setIcon'] },
    };
    const services: HostService[] = ['pageBackend'];
    const contracts = buildMcpContracts({
      pageTitles: 'page-map',
      manifest: customTools,
      overrides,
    });
    const stored = createHeadlessAgentSetup({ customTools, overrides, services, runtime: 'node' });
    const live = createHeadlessAgentSetup({ customTools, overrides, services, runtime: 'node-live' });

    expect(contracts.stored).toEqual(stored.contract);
    expect(contracts.live).toEqual(live.contract);
    expect([...contracts.runtimes.keys()].sort()).toEqual([...stored.tools.keys()].sort());
    for (const [name, runtime] of stored.tools) {
      if (!customTools.blocks.some(block => block.name === name)) {
        expect(contracts.runtimes.get(name)).toBe(runtime);
      }
    }
    for (const { name } of customTools.blocks) {
      const runtime = contracts.runtimes.get(name);

      expect(runtime?.name).toBe(name);
      expect(runtime?.actions).toEqual({});
      expect(runtime?.normalize).toBeUndefined();
      expect(runtime?.defaultChildren).toBeUndefined();
    }
    const ports = createHeadlessPorts({
      sanitizeFor: name => contracts.runtimes.get(name)?.sanitize,
      // Keep HTML output to observe sanitizer attributes.
      richTextFieldsFor: () => [],
    });
    const body = '<strong title="keep" onclick="drop">bold</strong>'
      + '<mark style="color: red; font-size: 2em; background-color: blue">color</mark>';

    expect(ports.sanitizeBlockData('note_x', { body })).toEqual({
      body: '<strong title="keep">bold</strong>'
        + '<mark style="color: red; background-color: blue;">color</mark>',
    });
    expect(ports.sanitizeBlockData('empty_note_x', { body })).toEqual({
      body: '<strong>bold</strong>'
        + '<mark style="color: red; background-color: blue;">color</mark>',
    });
  });
});
