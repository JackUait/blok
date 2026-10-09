// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../src/shared/agent/errors';
import { DocSnapshot } from '../../../src/shared/agent/snapshot';
import * as sharedIds from '../../../src/shared/mint-id';
import { PLAINTEXT } from '../../../src/shared/sanitize-rules';
import { createHeadlessPorts, loadStoredDocument } from '../../../src/view/agent-runtime';

import type { SanitizerConfig, ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { RichText } from '../../../types/rich-text';

const fields = (type: string): string[] =>
  type === 'paragraph' || type === 'toggle' ? ['text'] : [];

const rule: SanitizerConfig = { strong: true, a: { href: true } };
const headless = () => createHeadlessPorts({
  sanitizeFor: (type: string): ToolSanitizerConfig | undefined => type === 'paragraph' ? rule : undefined,
  richTextFieldsFor: fields,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless agent ports', () => {
  it('parses HTML with no browser globals', () => {
    expect(headless().htmlToSegments('a <strong>b</strong><br>c')).toEqual([
      { text: 'a ' },
      { text: 'b', marks: { bold: true } },
      { text: '\nc' },
    ]);
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('keeps allowed marks and removes forbidden marks and unsafe links', () => {
    const text: RichText = [
      { text: 'ok', marks: { bold: true } },
      { text: 'gone', marks: { italic: true } },
      { text: 'bad', marks: { link: { href: 'javascript:alert(1)' } } },
    ];

    expect(headless().sanitizeBlockData('paragraph', { text }).text).toEqual([
      { text: 'ok', marks: { bold: true } },
      { text: 'gonebad' },
    ]);
    expect(text).toEqual([
      { text: 'ok', marks: { bold: true } },
      { text: 'gone', marks: { italic: true } },
      { text: 'bad', marks: { link: { href: 'javascript:alert(1)' } } },
    ]);
  });

  it('hardens nested URLs when the tool has no sanitize rules', () => {
    const data = {
      html: '<a href="javascript:x">x</a>',
      nested: [{ html: '<img src="javascript:x">' }],
      count: 1,
    };

    expect(headless().sanitizeBlockData('embed', data)).toEqual({
      html: '<a>x</a>',
      nested: [{ html: '<img>' }],
      count: 1,
    });
    expect(data.nested).toEqual([{ html: '<img src="javascript:x">' }]);
    expect(data.html).toBe('<a href="javascript:x">x</a>');
  });

  it('keeps plaintext byte-identical despite global tag rules', () => {
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig => ({ code: PLAINTEXT }),
      richTextFieldsFor: () => [],
      globalSanitizer: { strong: true },
    });
    const code = 'a < b & c </tag> <a href="javascript:x">source</a>';

    expect(ports.sanitizeBlockData('code', {
      code,
      caption: '<i>caption</i><strong>ok</strong>',
    })).toEqual({ code, caption: 'caption<strong>ok</strong>' });
  });

  it('applies typed rich-field rules and preserves plaintext under global rules', () => {
    const toolRules: ToolSanitizerConfig = {
      text: { strong: true, a: { href: true } },
      source: PLAINTEXT,
    };
    const globalSanitizer: SanitizerConfig = { i: true };
    const text: RichText = [
      { text: 'bold', marks: { bold: true } },
      { text: 'italic', marks: { italic: true } },
      { text: 'link', marks: { link: { href: '/page', target: '_self', rel: 'noopener' } } },
    ];
    const source = 'a < b & c </tag> <a href="javascript:x">source</a>';
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig => toolRules,
      richTextFieldsFor: () => ['text'],
      globalSanitizer,
    });

    expect(ports.sanitizeBlockData('custom', { text, source })).toEqual({
      text: [
        { text: 'bold', marks: { bold: true } },
        { text: 'italic', marks: { italic: true } },
        { text: 'link', marks: { link: { href: '/page' } } },
      ],
      source,
    });
  });

  it('imports Markdown segments and a nonempty, explicit degradation warning', async () => {
    const result = await headless().markdownToBlocks('**hi**\n\n<div>x</div>');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings).toEqual([{
      code: 'MARKDOWN_DEGRADED',
      message: 'html degraded: HTML is escaped and stored as literal text; Blok has no raw-HTML block',
    }]);
    expect(result.blocks).toMatchObject([
      { type: 'paragraph', data: { text: [{ text: 'hi', marks: { bold: true } }] } },
      { type: 'paragraph', data: { text: [{ text: '<div>x</div>' }] } },
    ]);
  });

  it('exports segment marks and maps nonempty Markdown loss warnings', () => {
    const doc: OutputData = { blocks: [{
      id: 'p',
      type: 'paragraph',
      data: { text: [
        { text: 'hi', marks: { bold: true } },
        { text: 'low', marks: { underline: true } },
      ] },
    }] };
    const result = headless().blocksToMarkdown(doc);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings).toEqual([{
      code: 'MARKDOWN_DEGRADED',
      message: 'underline degraded: inline underline has no Markdown equivalent; the text is kept as ordinary text',
    }]);
    expect(result.markdown).toBe('**hi**low');
  });

  it('uses the shared ID minter by default and accepts an injected minter', () => {
    expect(headless().newId()).toMatch(/^[A-Za-z0-9_-]{10}$/);

    const sharedMint = vi.spyOn(sharedIds, 'mintId').mockReturnValue('shared-id');

    expect(headless().newId()).toBe('shared-id');
    expect(sharedMint).toHaveBeenCalledTimes(1);

    const newId = vi.fn(() => 'host-id');
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig | undefined => undefined,
      richTextFieldsFor: fields,
      newId,
    });

    expect(ports.newId()).toBe('host-id');
    expect(newId).toHaveBeenCalledTimes(1);
    expect(sharedMint).toHaveBeenCalledTimes(1);
  });
});

describe('stored document loader', () => {
  it('converts only declared rich fields and preserves page and saved fields', () => {
    const existing: RichText = [{ text: '<b>literal</b>', marks: { bold: true } }];
    const input: OutputData = {
      id: 'doc', version: 'saved-version', time: 0, title: 'T',
      icon: { type: 'image', url: 'https://example.com/icon.png' },
      blocks: [
        {
          id: 'p', type: 'paragraph',
          data: { text: 'a <strong>b</strong>', caption: '<b>untouched</b>' },
          tunes: { alignment: 'left' }, indent: 2, lastEditedAt: 123, lastEditedBy: 'author',
        },
        { id: 'q', type: 'paragraph', data: { text: existing } },
      ],
    };
    const before = structuredClone(input);
    const mint = vi.spyOn(sharedIds, 'mintId');

    expect(loadStoredDocument(input, fields)).toEqual({
      ...input,
      blocks: [
        {
          ...input.blocks[0],
          data: { text: [{ text: 'a ' }, { text: 'b', marks: { bold: true } }], caption: '<b>untouched</b>' },
        },
        { id: 'q', type: 'paragraph', data: { text: existing } },
      ],
    });
    expect(input).toEqual(before);

    const normalized = loadStoredDocument(input, fields);
    const normalizedBefore = structuredClone(normalized);

    expect(loadStoredDocument(normalized, fields)).toEqual(normalized);
    expect(normalized).toEqual(normalizedBefore);
    expect(mint).not.toHaveBeenCalled();
  });

  it('does not invent blocks or page fields for an empty document', () => {
    expect(loadStoredDocument({ blocks: [] }, fields)).toEqual({ blocks: [] });
  });

  it.each<{
    name: string;
    blocks: OutputBlockData[];
    candidates: string[];
    expectedIds: string[];
    metadataIndex: number;
  }>([
    {
      name: 'missing and empty IDs',
      blocks: [
        {
          type: 'paragraph', data: { text: 'one' },
          tunes: { alignment: 'left' }, indent: 2, lastEditedAt: 123, lastEditedBy: 'author',
        },
        { id: '', type: 'paragraph', data: { text: 'two' } },
        { id: 'stable', type: 'paragraph', data: { text: 'three' } },
      ],
      candidates: ['missing-id', 'empty-id__'],
      expectedIds: ['missing-id', 'empty-id__', 'stable'],
      metadataIndex: 0,
    },
    {
      name: 'unreferenced duplicate IDs',
      blocks: [
        { id: 'duplicate', type: 'paragraph', data: { text: 'one' } },
        {
          id: 'duplicate', type: 'paragraph', data: { text: 'two' },
          tunes: { alignment: 'left' }, indent: 2, lastEditedAt: 123, lastEditedBy: 'author',
        },
        { id: 'stable', type: 'paragraph', data: { text: 'three' } },
      ],
      candidates: ['repaired-x'],
      expectedIds: ['duplicate', 'repaired-x', 'stable'],
      metadataIndex: 1,
    },
  ])('normalizes $name before the strict snapshot boundary', ({ blocks, candidates, expectedIds, metadataIndex }) => {
    const input: OutputData = {
      id: 'doc', version: 'saved-version', time: 0, title: 'T',
      icon: { type: 'image', url: 'https://example.com/icon.png' },
      blocks,
    };
    const before = structuredClone(input);
    const mint = vi.spyOn(sharedIds, 'mintId');

    for (const candidate of candidates) {
      mint.mockReturnValueOnce(candidate);
    }

    const loaded = loadStoredDocument(input, fields);

    expect(loaded.blocks.map(block => block.id)).toEqual(expectedIds);
    expect(() => DocSnapshot.fromOutput(loaded)).not.toThrow();
    expect(loaded.blocks).toHaveLength(3);
    expect(loaded.blocks.map(block => block.data.text)).toEqual([
      [{ text: 'one' }], [{ text: 'two' }], [{ text: 'three' }],
    ]);
    expect(input).toEqual(before);
    expect(loaded).toMatchObject({
      id: 'doc', version: 'saved-version', time: 0, title: 'T',
      icon: { type: 'image', url: 'https://example.com/icon.png' },
    });
    expect(loaded.blocks[metadataIndex]).toMatchObject({
      tunes: { alignment: 'left' }, indent: 2, lastEditedAt: 123, lastEditedBy: 'author',
    });

    const normalizedBefore = structuredClone(loaded);

    expect(loadStoredDocument(loaded, fields)).toEqual(loaded);
    expect(loaded).toEqual(normalizedBefore);
    expect(mint).toHaveBeenCalledTimes(candidates.length);
  });

  it('keeps the first duplicate and leaves ambiguous parent and content references unchanged', () => {
    const input: OutputData = { blocks: [
      { id: 'x', type: 'toggle', data: { text: 'first' }, content: ['c', 'c'] },
      { id: 'x', type: 'toggle', data: { text: 'second' }, content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: 'child' }, parent: 'x' },
    ] };
    const before = structuredClone(input);

    vi.spyOn(sharedIds, 'mintId').mockReturnValueOnce('renamed-x_');

    const loaded = loadStoredDocument(input, fields);

    expect(loaded.blocks).toEqual([
      { id: 'x', type: 'toggle', data: { text: [{ text: 'first' }] }, content: ['c', 'c'] },
      { id: 'renamed-x_', type: 'toggle', data: { text: [{ text: 'second' }] }, content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: [{ text: 'child' }] }, parent: 'x' },
    ]);

    const snapshot = DocSnapshot.fromOutput(loaded);

    expect(snapshot.parentOf('c')).toBe('x');
    expect(snapshot.childrenOf('x')).toEqual(['c']);
    expect(snapshot.childrenOf('renamed-x_')).toEqual([]);
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['x', 'c', 'renamed-x_']);
    expect(input).toEqual(before);
  });

  it('omits a renamed duplicate self-parent without changing the first survivor or its child', () => {
    const input: OutputData = { blocks: [
      { id: 'x', type: 'toggle', data: {}, parent: 'x', content: ['c'] },
      { id: 'x', type: 'toggle', data: {}, parent: 'x', content: ['c'] },
      { id: 'c', type: 'paragraph', data: {}, parent: 'x' },
    ] };
    const before = structuredClone(input);

    vi.spyOn(sharedIds, 'mintId').mockReturnValueOnce('renamed-x_');

    const loaded = loadStoredDocument(input, fields);
    const [first, renamed] = loaded.blocks;

    if (first === undefined || renamed === undefined) {
      throw new Error('Expected both duplicate records');
    }

    expect(renamed).not.toHaveProperty('parent');
    expect(first.parent).toBe('x');
    expect(loaded.blocks.map(block => block.id)).toEqual(['x', 'renamed-x_', 'c']);
    expect(first.content).toEqual(['c']);
    expect(renamed.content).toEqual(['c']);

    const snapshot = DocSnapshot.fromOutput(loaded);

    expect(snapshot.childrenOf(null)).toEqual(['x', 'renamed-x_']);
    expect(snapshot.parentOf('x')).toBeNull();
    expect(snapshot.parentOf('renamed-x_')).toBeNull();
    expect(snapshot.parentOf('c')).toBe('x');
    expect(snapshot.childrenOf('x')).toEqual(['c']);
    expect(snapshot.childrenOf('renamed-x_')).toEqual([]);
    expect(input).toEqual(before);
  });

  it('keeps a duplicate cell reference on the first survivor without assigning the replacement a cell', () => {
    const input: OutputData = { blocks: [
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['x'] }]] } },
      { id: 'x', type: 'paragraph', data: {}, parent: 'table' },
      { id: 'x', type: 'paragraph', data: {}, parent: 'table' },
    ] };
    const before = structuredClone(input);

    vi.spyOn(sharedIds, 'mintId').mockReturnValueOnce('renamed-x_');

    const loaded = loadStoredDocument(input, fields);

    expect(loaded.blocks.map(block => block.id)).toEqual(['table', 'x', 'renamed-x_']);
    expect(loaded.blocks.find(block => block.id === 'table')?.data.content).toEqual([[{ blocks: ['x'] }]]);

    const snapshot = DocSnapshot.fromOutput(loaded);

    expect(snapshot.cellOf('renamed-x_')).toBeNull();
    expect(snapshot.cellOf('x')).toEqual({ tableId: 'table', row: 0, col: 0 });
    expect(snapshot.parentOf('renamed-x_')).toBe('table');
    expect(snapshot.childrenOf('table')).toEqual(['x', 'renamed-x_']);
    expect(input).toEqual(before);
  });

  it.each<{
    name: string;
    blocks: OutputBlockData[];
    candidates: string[];
    expectedIds: string[];
  }>([
    {
      name: 'a later existing ID',
      blocks: [
        { type: 'paragraph', data: { text: 'one' } },
        { id: 'future-id_', type: 'paragraph', data: { text: 'two' } },
      ],
      candidates: ['future-id_', 'fresh-id__'],
      expectedIds: ['fresh-id__', 'future-id_'],
    },
    {
      name: 'an already generated ID',
      blocks: [
        { type: 'paragraph', data: { text: 'one' } },
        { type: 'paragraph', data: { text: 'two' } },
      ],
      candidates: ['first-new_', 'first-new_', 'second-new'],
      expectedIds: ['first-new_', 'second-new'],
    },
  ])('retries a collision with $name', ({ blocks, candidates, expectedIds }) => {
    const input: OutputData = { blocks };
    const before = structuredClone(input);
    const mint = vi.spyOn(sharedIds, 'mintId');

    for (const candidate of candidates) {
      mint.mockReturnValueOnce(candidate);
    }

    const loaded = loadStoredDocument(input, fields);

    expect(loaded.blocks.map(block => block.id)).toEqual(expectedIds);
    expect(() => DocSnapshot.fromOutput(loaded)).not.toThrow();
    expect(loaded.blocks.map(block => block.data.text)).toEqual([[{ text: 'one' }], [{ text: 'two' }]]);
    expect(input).toEqual(before);
    expect(mint).toHaveBeenCalledTimes(candidates.length);
  });

  it.each<{ name: 'parent' | 'content' | 'table-cell'; blocks: OutputBlockData[]; expectedIds: string[] }>([
    {
      name: 'parent',
      blocks: [
        { type: 'paragraph', data: {} },
        { id: 'orphan', type: 'paragraph', data: {}, parent: 'reserved__' },
      ],
      expectedIds: ['free-id___', 'orphan'],
    },
    {
      name: 'content',
      blocks: [
        { type: 'paragraph', data: {}, parent: 'parent' },
        { id: 'parent', type: 'toggle', data: {}, content: ['reserved__'] },
      ],
      expectedIds: ['free-id___', 'parent'],
    },
    {
      name: 'table-cell',
      blocks: [
        { type: 'paragraph', data: {}, parent: 'table' },
        { id: 'table', type: 'table', data: { content: [[{ blocks: ['reserved__'] }]] } },
      ],
      expectedIds: ['free-id___', 'table'],
    },
  ])('does not resurrect a dangling $name reference when minting an ID', ({ name, blocks, expectedIds }) => {
    const input: OutputData = { blocks };
    const before = structuredClone(input);
    const mint = vi.spyOn(sharedIds, 'mintId')
      .mockReturnValueOnce('reserved__')
      .mockReturnValueOnce('free-id___');
    const loaded = loadStoredDocument(input, fields);

    expect(loaded.blocks.map(block => block.id)).toEqual(expectedIds);

    const snapshot = DocSnapshot.fromOutput(loaded);

    expect(snapshot.has('reserved__')).toBe(false);

    if (name === 'parent') {
      expect(loaded.blocks.find(block => block.id === 'orphan')?.parent).toBe('reserved__');
      expect(snapshot.parentOf('orphan')).toBeNull();
      expect(snapshot.childrenOf(null)).toEqual(['free-id___', 'orphan']);
    } else if (name === 'content') {
      expect(loaded.blocks.find(block => block.id === 'parent')?.content).toEqual(['reserved__']);
      expect(snapshot.childrenOf('parent')).toEqual(['free-id___']);
      expect(snapshot.parentOf('free-id___')).toBe('parent');
    } else {
      expect(loaded.blocks.find(block => block.id === 'table')?.data.content).toEqual([[{ blocks: ['reserved__'] }]]);
      expect(snapshot.childrenOf('table')).toEqual(['free-id___']);
      expect(snapshot.cellOf('free-id___')).toBeNull();
    }

    expect(input).toEqual(before);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('repairs only supplied block identities and does not reserve arbitrary saved strings', () => {
    const nested: OutputData = { blocks: [
      { type: 'paragraph', data: { text: 'nested' } },
      { id: 'candidate_', type: 'paragraph', data: { text: 'first' } },
      { id: 'candidate_', type: 'paragraph', data: { text: 'second' } },
    ] };
    const input: OutputData = { blocks: [
      { id: ' ', type: 'database-row', data: { properties: { rich: nested } } },
      {
        type: 'custom',
        data: { pageId: 'candidate_', label: 'candidate_', text: '<b>literal</b>' },
        tunes: { label: 'candidate_' },
      },
    ] };
    const before = structuredClone(input);
    const mint = vi.spyOn(sharedIds, 'mintId').mockReturnValueOnce('candidate_');
    const loaded = loadStoredDocument(input, fields);

    expect(loaded.blocks.map(block => block.id)).toEqual([' ', 'candidate_']);
    expect(loaded.blocks).toEqual([
      {
        id: ' ', type: 'database-row',
        data: { properties: { rich: { blocks: [
          { type: 'paragraph', data: { text: [{ text: 'nested' }] } },
          { id: 'candidate_', type: 'paragraph', data: { text: [{ text: 'first' }] } },
          { id: 'candidate_', type: 'paragraph', data: { text: [{ text: 'second' }] } },
        ] } } },
      },
      {
        id: 'candidate_', type: 'custom',
        data: { pageId: 'candidate_', label: 'candidate_', text: '<b>literal</b>' },
        tunes: { label: 'candidate_' },
      },
    ]);
    expect(() => DocSnapshot.fromOutput(loaded)).not.toThrow();
    expect(input).toEqual(before);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('does not retain a repair mapping between loads of malformed input', () => {
    const input: OutputData = { blocks: [{ type: 'paragraph', data: { text: 'one' } }] };
    const before = structuredClone(input);
    const mint = vi.spyOn(sharedIds, 'mintId')
      .mockReturnValueOnce('first-new_')
      .mockReturnValueOnce('second-new');
    const first = loadStoredDocument(input, fields);
    const second = loadStoredDocument(input, fields);

    expect(first.blocks.map(block => block.id)).toEqual(['first-new_']);
    expect(second.blocks.map(block => block.id)).toEqual(['second-new']);
    expect(first.blocks.map(block => block.data.text)).toEqual([[{ text: 'one' }]]);
    expect(second.blocks.map(block => block.data.text)).toEqual([[{ text: 'one' }]]);
    expect(input).toEqual(before);

    expect(loadStoredDocument(first, fields)).toEqual(first);
    expect(loadStoredDocument(second, fields)).toEqual(second);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('keeps child membership and first-occurrence content order through loading', () => {
    const input: OutputData = { blocks: [
      { id: 'left', type: 'toggle', data: {}, content: ['b', 'a', 'b', 'missing', 'foreign', 'root'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'left' },
      { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'left' },
      { id: 'right', type: 'toggle', data: {} },
      { id: 'foreign', type: 'paragraph', data: {}, parent: 'right' },
      { id: 'root', type: 'paragraph', data: {} },
    ] };
    const before = structuredClone(input);
    const snapshot = DocSnapshot.fromOutput(loadStoredDocument(input, fields));

    expect(snapshot.childrenOf('left')).toEqual(['b', 'a']);
    expect(snapshot.childrenOf('right')).toEqual(['foreign']);
    expect(snapshot.childrenOf(null)).toEqual(['left', 'right', 'root']);
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['left', 'b', 'a', 'right', 'foreign', 'root']);
    expect(input).toEqual(before);
  });

  it('keeps dangling and self-parent promotion without losing descendants', () => {
    const snapshot = DocSnapshot.fromOutput(loadStoredDocument({ blocks: [
      { id: 'orphan', type: 'toggle', data: {}, parent: 'missing', content: ['child'] },
      { id: 'child', type: 'paragraph', data: {}, parent: 'orphan' },
      { id: 'self', type: 'toggle', data: {}, parent: 'self', content: ['self', 'self-child'] },
      { id: 'self-child', type: 'paragraph', data: {}, parent: 'self' },
    ] }, fields));

    expect(snapshot.childrenOf(null)).toEqual(['orphan', 'self']);
    expect(snapshot.childrenOf('orphan')).toEqual(['child']);
    expect(snapshot.childrenOf('self')).toEqual(['self-child']);
    expect(snapshot.parentOf('orphan')).toBeNull();
    expect(snapshot.parentOf('self')).toBeNull();
  });

  it.each<{ name: string; blocks: OutputBlockData[] }>([
    {
      name: 'two-block cycle',
      blocks: [
        { id: 'a', type: 'toggle', data: {}, parent: 'b' },
        { id: 'b', type: 'toggle', data: {}, parent: 'a' },
      ],
    },
    {
      name: 'three-block cycle',
      blocks: [
        { id: 'a', type: 'toggle', data: {}, parent: 'c' },
        { id: 'b', type: 'toggle', data: {}, parent: 'a' },
        { id: 'c', type: 'toggle', data: {}, parent: 'b' },
      ],
    },
  ])('does not silently repair a $name at the snapshot boundary', ({ blocks }) => {
    expect(() => DocSnapshot.fromOutput(loadStoredDocument({ blocks }, fields))).toThrow(AgentFailure);

    try {
      DocSnapshot.fromOutput(loadStoredDocument({ blocks }, fields));
    } catch (error: unknown) {
      if (!(error instanceof AgentFailure)) {
        throw error;
      }

      expect(error.error.code).toBe('INVALID_ARGS');

      return;
    }

    throw new Error('Expected a parent cycle failure');
  });
});
