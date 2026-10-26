// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contentRevision } from '../../../src/shared/agent/revision';
import { readCustomToolsFile } from '../../../src/shared/custom-tools-file';
import { isObject } from '../../../src/shared/type-guards';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../src/view/agent-runtime';
import { invoke } from '../../../src/view/server-runtime';

import type { BlokCustomToolsFile, HostService, ManifestOverrides } from '../../../types';
import type { AgentActor, AgentBatch, AgentErrorCode, Edit } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { RichText } from '../../../types/rich-text';

const actor: AgentActor = { id: 'agent-jint', name: 'Server agent', kind: 'agent' };
const document: OutputData = {
  blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Hello world' } }],
};
const readBatch: AgentBatch = { commands: [{ name: 'doc.read', args: { detail: 'full' } }] };
const customTools: BlokCustomToolsFile = {
  formatVersion: 1,
  blocks: [{
    name: 'quiz',
    statics: {
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
    },
    description: {
      summary: 'A quiz.',
      data: {
        type: 'object',
        properties: { score: { type: 'integer' } },
        required: ['score'],
        additionalProperties: false,
      },
    },
  }],
};
const normalizedDocument = (): OutputData =>
  loadStoredDocument(document, createHeadlessAgentSetup({ runtime: 'jint' }).richTextFieldsFor);
const executeWire = async (input: unknown): Promise<Record<string, unknown>> => {
  const response: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify(input)));

  if (!isObject(response)) {
    throw new TypeError('agentExecute must return a JSON object.');
  }

  return response;
};

describe('server runtime agentExecute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1234);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats stored text and returns the applied edits and content revision', async () => {
    const text: RichText = [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }];
    const expectedDocument: OutputData = {
      blocks: [{
        id: 'p', type: 'paragraph', data: { text },
        lastEditedBy: actor.id, lastEditedAt: 1234,
      }],
    };
    const expectedEdits: Edit[] = [{ op: 'setRichText', id: 'p', field: 'text', value: text }];
    const batch: AgentBatch = {
      commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: true } } }],
    };
    const output = await executeWire({ document, actor, batch });

    expect(output.edits).toEqual(expectedEdits);
    expect(output.document).toEqual(expectedDocument);
    expect(output.result).toMatchObject({
      ok: true, revision: contentRevision(expectedDocument),
      changed: { created: [], updated: ['p'], moved: [], removed: [] },
    });
  });

  it('runs a read batch without applied edits and preserves unknown document and block keys', async () => {
    const stored = {
      id: 'doc-1', version: 'fixture', time: 7, title: 'Original',
      metadata: { keep: 'document' },
      blocks: [
        { id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello' }] }, metadata: { keep: 'paragraph' } },
        { id: 'opaque', type: 'thirdParty', data: { payload: { keep: true } }, metadata: { keep: 'opaque' } },
      ],
    };
    const output = await executeWire({ document: stored, actor, batch: readBatch });

    expect(output.document).toEqual(stored);
    expect(output.edits).toEqual([]);
    expect(output.result).toMatchObject({
      ok: true, revision: contentRevision(stored),
      results: [{
        revision: contentRevision(stored),
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello' }] } },
          { id: 'opaque', type: 'thirdParty', opaque: true },
        ],
      }],
    });
  });

  it('returns no edits or partial document changes when a later command fails', async () => {
    const batch: AgentBatch = { commands: [
      { name: 'doc.setTitle', args: { title: 'Never written' } },
      { name: 'block.delete', args: { id: 'missing' } },
    ] };
    const expectedDocument = normalizedDocument();
    const output = await executeWire({ document, actor, batch });

    expect(output.edits).toEqual([]);
    expect(output.document).toEqual(expectedDocument);
    expect(output.result).toMatchObject({
      ok: false, revision: contentRevision(expectedDocument),
      error: { code: 'BLOCK_NOT_FOUND', commandIndex: 1 },
    });
  });

  it.each(['history.undo', 'history.redo'] satisfies AgentBatch['commands'][number]['name'][])(
    'refuses %s as unavailable when the call carries no session history',
    async name => {
      const expectedDocument = normalizedDocument();
      const batch: AgentBatch = { commands: [{ name, args: {} }] };
      const output = await executeWire({ document, actor, batch });

      expect(output.result).toMatchObject({
        ok: false, revision: contentRevision(expectedDocument),
        error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } },
      });
      expect(output.edits).toEqual([]);
      expect(output.document).toEqual(expectedDocument);
      expect(output).not.toHaveProperty('history');
    }
  );

  describe('session history carried between calls', () => {
    const undo: AgentBatch = { commands: [{ name: 'history.undo', args: {} }] };
    const redo: AgentBatch = { commands: [{ name: 'history.redo', args: {} }] };
    const rename = (title: string): AgentBatch => ({ commands: [{ name: 'doc.setTitle', args: { title } }] });

    it('undoes and redoes the batches of earlier calls', async () => {
      const first = await executeWire({ document, actor, batch: rename('One'), history: {} });
      const second = await executeWire({ document: first.document, actor, batch: rename('Two'), history: first.history });
      const undone = await executeWire({ document: second.document, actor, batch: undo, history: second.history });

      expect(undone.result).toMatchObject({ ok: true, results: [{}] });
      expect(undone.document).toEqual(first.document);
      const again = await executeWire({ document: undone.document, actor, batch: undo, history: undone.history });

      expect(again.document).toEqual(normalizedDocument());
      const redone = await executeWire({ document: again.document, actor, batch: redo, history: again.history });

      expect(redone.result).toMatchObject({ ok: true });
      expect(redone.document).toEqual(first.document);
      expect(await executeWire({ document: redone.document, actor, batch: undo, history: redone.history }))
        .toMatchObject({ result: { ok: true }, document: normalizedDocument() });
    });

    it('refuses with CONFLICT when someone else saved the document since the last step', async () => {
      const first = await executeWire({ document, actor, batch: rename('One'), history: {} });
      const theirs = { ...normalizedDocument(), title: 'Theirs' };
      const refused = await executeWire({ document: theirs, actor, batch: undo, history: first.history });

      expect(refused.result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(refused.document).toEqual(theirs);
      const written = await executeWire({ document: theirs, actor, batch: rename('Mine'), history: refused.history });
      const undone = await executeWire({ document: written.document, actor, batch: undo, history: written.history });

      expect(undone.document).toEqual(theirs);
      expect((await executeWire({ document: undone.document, actor, batch: undo, history: undone.history })).result)
        .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    });

    it('answers UNDO_OTHER_DOCUMENT when the last step wrote another document', async () => {
      const first = await executeWire({ document, actor, batch: rename('One'), history: {} });
      const history = first.history;

      if (!isObject(history) || !Array.isArray(history.past)) {
        throw new TypeError('agentExecute must return the session history.');
      }
      const refused = await executeWire({
        document: first.document, actor, batch: undo, history: { ...history, past: [...history.past, 'other'] },
      });

      expect(refused.result).toMatchObject({ ok: false, error: { code: 'UNDO_OTHER_DOCUMENT' } });
      expect(refused.document).toEqual(first.document);
    });
  });

  it('offers history.undo to a C# session and a C# room, not to a plain call', async () => {
    const room: unknown = JSON.parse(await invoke('manifest', JSON.stringify({ runtime: 'csharp-live' })));
    const session: unknown = JSON.parse(await invoke('manifest', JSON.stringify({ history: {} })));
    const plain: unknown = JSON.parse(await invoke('manifest', JSON.stringify({})));
    const commandIn = (value: unknown, name: string): unknown => {
      const contract = isObject(value) && isObject(value.contract) ? value.contract : {};

      return (Array.isArray(contract.commands) ? contract.commands : [])
        .find((entry: unknown) => isObject(entry) && entry.name === name);
    };

    expect(commandIn(room, 'history.undo')).toMatchObject({ available: true });
    expect(commandIn(session, 'history.undo')).toMatchObject({ available: true });
    expect(commandIn(plain, 'history.undo')).toMatchObject({ available: false, unavailableReason: 'runtime' });
  });

  it.each([
    { name: 'paragraph.missing', args: {}, code: 'UNKNOWN_COMMAND' },
    { name: 'doc.setTitle', args: { title: 17 }, code: 'INVALID_ARGS' },
  ] satisfies Array<{ name: AgentBatch['commands'][number]['name']; args: Record<string, unknown>; code: AgentErrorCode }>)(
    'keeps a valid envelope with $name errors in an AgentResult',
    async ({ name, args, code }) => {
      const batch: AgentBatch = { commands: [{ name, args }] };
      const expectedDocument = normalizedDocument();
      const output = await executeWire({ document, actor, batch });

      expect(output.result).toMatchObject({ ok: false, error: { code } });
      expect(output.edits).toEqual([]);
      expect(output.document).toEqual(expectedDocument);
    }
  );

  it('keeps a bare unknown command in a structured AgentResult', async () => {
    const batch = { commands: [{ name: 'unknown', args: {} }] };
    const output = await executeWire({ document, actor, batch });

    expect(output.result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
    expect(output.edits).toEqual([]);
    expect(output.document).toEqual(normalizedDocument());
  });

  it('refuses a stale content revision without applying edits', async () => {
    const expectedDocument = normalizedDocument();
    const batch: AgentBatch = {
      expectRevision: 'h0',
      commands: [{ name: 'doc.setTitle', args: { title: 'Never written' } }],
    };
    const output = await executeWire({ document, actor, batch });

    expect(output.edits).toEqual([]);
    expect(output.document).toEqual(expectedDocument);
    expect(output.result).toMatchObject({
      ok: false, revision: contentRevision(expectedDocument), error: { code: 'STALE', retryable: true },
    });
  });

  it.each([
    { field: 'document', label: 'missing', value: undefined },
    { field: 'document', label: 'null', value: null },
    { field: 'document', label: 'array', value: [] },
    { field: 'document', label: 'missing blocks', value: {} },
    { field: 'document', label: 'non-array blocks', value: { blocks: {} } },
    { field: 'document', label: 'malformed block', value: { blocks: [null] } },
    { field: 'document', label: 'non-string block type', value: { blocks: [{ id: 'p', type: 17, data: {} }] } },
    { field: 'document', label: 'non-record block data', value: { blocks: [{ id: 'p', type: 'paragraph', data: [] }] } },
    { field: 'actor', label: 'missing', value: undefined },
    { field: 'actor', label: 'null', value: null },
    { field: 'actor', label: 'array', value: [] },
    { field: 'actor', label: 'non-string id', value: { ...actor, id: 17 } },
    { field: 'actor', label: 'missing name', value: { id: actor.id, kind: 'agent' } },
    { field: 'actor', label: 'wrong kind', value: { ...actor, kind: 'user' } },
    { field: 'batch', label: 'missing', value: undefined },
    { field: 'batch', label: 'null', value: null },
    { field: 'batch', label: 'array', value: [] },
    { field: 'batch', label: 'missing commands', value: {} },
    { field: 'batch', label: 'non-array commands', value: { commands: {} } },
    { field: 'batch', label: 'malformed command', value: { commands: [null] } },
  ])('throws a TypeError naming $field for $label input', async ({ field, value }) => {
    const input = { document, actor, batch: readBatch, [field]: value };
    const pending = invoke('agentExecute', JSON.stringify(input));

    await expect(pending).rejects.toBeInstanceOf(TypeError);
    await expect(pending).rejects.toThrow(new RegExp(field));
  });

  it('credits the person the agent acts for, with the agent, on an insert', async () => {
    const batch: AgentBatch = {
      commands: [{ name: 'block.insert', args: { id: 'q', type: 'quiz', data: { score: 1 } } }],
    };
    const output = await executeWire({ document, actor: { ...actor, onBehalfOf: 'human-7' }, batch, customTools });
    expect(output.document).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ id: 'q', createdBy: 'human-7', createdWith: actor.id, lastEditedBy: 'human-7', lastEditedWith: actor.id }),
      ]),
    });
  });

  it('reads a custom tool file and accepts declared services when inserting a custom block', async () => {
    const services: HostService[] = ['pageBackend', 'host', 'uploader', 'linkMetadata'];
    const batch: AgentBatch = {
      commands: [{ name: 'block.insert', args: { id: 'q', type: 'quiz', data: { score: 1 } } }],
    };
    const before = normalizedDocument();
    const expectedDocument: OutputData = {
      ...before,
      blocks: [
        ...before.blocks,
        {
          id: 'q', type: 'quiz', data: { score: 1 },
          createdBy: actor.id, createdAt: 1234, lastEditedBy: actor.id, lastEditedAt: 1234,
        },
      ],
    };
    const expectedEdits: Edit[] = [{
      op: 'insert',
      block: { id: 'q', type: 'quiz', data: { score: 1 }, children: [] },
      parentId: null, afterId: 'p',
    }];
    const output = await executeWire({ document, actor, batch, customTools, services });

    expect(output.edits).toEqual(expectedEdits);
    expect(output.document).toEqual(expectedDocument);
    expect(output.result).toMatchObject({ ok: true, revision: contentRevision(expectedDocument) });
  });

  it('honors hidden tool overrides without dropping existing stored blocks', async () => {
    const overrides: ManifestOverrides = { spacer: { hidden: true } };
    const batch: AgentBatch = { commands: [{ name: 'block.insert', args: { type: 'spacer', data: {} } }] };
    const output = await executeWire({ document, actor, batch, overrides });

    expect(output.result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(output.edits).toEqual([]);
    expect(output.document).toEqual(normalizedDocument());
  });

  it('propagates the actual custom tools reader error', async () => {
    const malformed: unknown = { formatVersion: 1, blocks: [{ name: 'quiz' }] };
    let readerError: TypeError | undefined;

    try {
      readCustomToolsFile(malformed);
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      readerError = error;
    }

    if (readerError === undefined) {
      throw new Error('Expected the custom tools reader to refuse malformed input.');
    }

    await expect(invoke('agentExecute', JSON.stringify({
      document, actor, batch: readBatch, customTools: malformed,
    }))).rejects.toMatchObject({ name: readerError.name, message: readerError.message });
  });
});
