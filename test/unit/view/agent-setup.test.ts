// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as versions from '../../../src/components/utils/version';
import { COMMANDS } from '../../../src/shared/agent/commands';
import * as builtInSnapshots from '../../../src/shared/built-in-snapshot';
import { readCustomToolsFile } from '../../../src/shared/custom-tools-file';
import * as toolManifests from '../../../src/shared/tool-manifest';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';

import type { BlokCustomToolsFile, HostService, SnapshotBlockStatics } from '../../../types';
import type { AgentPorts } from '../../../src/shared/agent/types';

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

const ratingTools: BlokCustomToolsFile = {
  formatVersion: 1,
  blocks: [{
    name: 'rating',
    description: {
      summary: 'A star rating.',
      data: {
        type: 'object',
        properties: { stars: { type: 'integer', minimum: 0, maximum: 5 } },
      },
    },
    statics: customStatics,
  }],
};

describe('createHeadlessAgentSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a contract with the core commands and the built-in tools', () => {
    vi.spyOn(versions, 'getBlokVersion').mockReturnValue('task-21-version');

    const setup = createHeadlessAgentSetup();
    const names = setup.contract.commands.map(entry => entry.name);

    expect(names).toContain('block.insert');
    expect(setup.contract.commands.filter(entry => entry.source === 'core').map(entry => entry.name))
      .toEqual(Object.keys(COMMANDS).sort());
    expect(setup.contract.manifest.blokVersion).toBe('task-21-version');
    expect(setup.contract.manifest.blocks.some(entry => entry.name === 'table')).toBe(true);
    expect(setup.tools.get('paragraph')?.sanitize).toBeDefined();
    expect(setup.richTextFieldsFor('paragraph')).toEqual(['text']);
    expect(setup.contract.commands.find(entry => entry.name === 'history.undo'))
      .toMatchObject({ available: true });
  });

  it('marks undo unavailable in a live room and available in a stored one', () => {
    const stored = createHeadlessAgentSetup({ runtime: 'node' });
    const live = createHeadlessAgentSetup({ runtime: 'node-live' });
    const jint = createHeadlessAgentSetup({ runtime: 'jint' });

    for (const name of ['history.undo', 'history.redo']) {
      expect(live.contract.commands.find(entry => entry.name === name))
        .toMatchObject({ available: false, unavailableReason: 'runtime' });
      expect(stored.contract.commands.find(entry => entry.name === name))
        .toMatchObject({ available: true });
      expect(jint.contract.commands.find(entry => entry.name === name))
        .toMatchObject({ available: false, unavailableReason: 'runtime' });
    }
  });

  it('adds a custom tool from a BlokCustomToolsFile', () => {
    const setup = createHeadlessAgentSetup({ customTools: readCustomToolsFile(ratingTools) });

    expect(setup.contract.manifest.blocks.find(entry => entry.name === 'rating'))
      .toMatchObject({ level: 'described', data: ratingTools.blocks[0]?.description.data });
    expect(setup.tools.has('rating')).toBe(true);
    expect(setup.richTextFieldsFor('rating')).toEqual([]);
  });

  it('applies manifest overrides before resolving rich fields', () => {
    const setup = createHeadlessAgentSetup({
      overrides: {
        header: { hidden: true },
        paragraph: { guidance: 'Host paragraph rule.' },
      },
    });

    expect(setup.contract.manifest.blocks.some(entry => entry.name === 'header')).toBe(false);
    expect(setup.richTextFieldsFor('header')).toEqual([]);
    expect(setup.richTextFieldsFor('missing')).toEqual([]);
    expect(setup.richTextFieldsFor('paragraph')).toEqual(['text']);
    expect(setup.contract.guidance.tools.paragraph).toContain('Host paragraph rule.');
  });

  it('passes host services to both the snapshot and runtime contract', () => {
    const services: HostService[] = ['pageBackend', 'host'];
    const snapshotBuilder = vi.spyOn(builtInSnapshots, 'buildBuiltInSnapshot');
    const contractBuilder = vi.spyOn(toolManifests, 'buildAgentContract');

    createHeadlessAgentSetup({ runtime: 'node-live', services });

    expect(contractBuilder.mock.calls[0]?.[2]).toEqual({ runtime: 'node-live', services });
    expect(snapshotBuilder.mock.calls[0]?.[0])
      .toEqual(expect.objectContaining({ blokVersion: versions.getBlokVersion(), services }));
  });

  it('forwards the global sanitizer while keeping built-in code plaintext', () => {
    const setup = createHeadlessAgentSetup({ globalSanitizer: { strong: true } });
    const code = 'a < b & c </tag> <a href="javascript:x">source</a>';

    expect(setup.ports.sanitizeBlockData('code', {
      code,
      caption: '<i>caption</i><strong>ok</strong>',
    })).toEqual({ code, caption: 'caption<strong>ok</strong>' });
    expect(createHeadlessAgentSetup().ports.sanitizeBlockData('code', {
      caption: '<strong>ok</strong>',
    })).toEqual({ caption: 'ok' });
  });

  it('forwards an optional page-document port without inventing one', () => {
    const openPageDocument: AgentPorts['openPageDocument'] = () =>
      Promise.reject(new Error('This test does not open a page'));
    const setup = createHeadlessAgentSetup({ openPageDocument });

    expect(setup.ports.openPageDocument).toBe(openPageDocument);
    expect(createHeadlessAgentSetup().ports.openPageDocument).toBeUndefined();
  });

  it('uses custom rich fields and their sanitizer only in the requested setup', () => {
    const customTools: BlokCustomToolsFile = {
      formatVersion: 1,
      blocks: [{
        name: 'quiz',
        description: { summary: 'A note.', data: {} },
        statics: { ...customStatics, richTextFields: ['question'] },
        sanitize: { question: { p: true, em: false }, enabled: true, caption: false },
      }],
    };
    const setup = createHeadlessAgentSetup({ customTools: readCustomToolsFile(customTools) });

    expect(setup.ports.sanitizeBlockData('quiz', {
      question: '<em>plain</em><strong>bold</strong>',
      caption: '<strong>plain</strong>',
      enabled: '<strong>kept</strong>',
    })).toEqual({
      question: [
        { text: 'plain' },
        { text: 'bold', marks: { bold: true } },
      ],
      caption: 'plain',
      enabled: '<strong>kept</strong>',
    });
    expect(setup.richTextFieldsFor('quiz')).toEqual(['question']);
    expect(createHeadlessAgentSetup().tools.has('quiz')).toBe(false);
  });
});
