import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import {
  createEditorPorts,
  editorRichTextFieldsFor,
} from '../../../../../src/components/modules/agent/editor-ports';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { Header, List, Paragraph } from '../../../../../src/tools';

import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { ToolSanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { OutputData } from '../../../../../types/data-formats/output-data';
import type { RichText } from '../../../../../types/rich-text';
import type {
  BlockTool,
  BlockToolConstructorOptions,
} from '../../../../../types/tools/block-tool';
import { editorSnapshot } from '../../../../../src/components/modules/agent/editor-snapshot';
import { readCustomToolsFile } from '../../../../../src/shared/custom-tools-file';
import { DatabaseTool } from '../../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../../src/tools/database-row';
import { createHeadlessAgentSetup } from '../../../../../src/view/agent-runtime';
import type { BlokCustomToolsFile, DatabaseData, DatabaseRowData } from '../../../../../types';

let holder: HTMLDivElement | undefined;
let core: Core | undefined;

class DeclaredFieldsTool implements BlockTool {
  public static get richTextFields(): string[] {
    return ['body', 'caption'];
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      body: { strong: {}, a: { href: true } },
      caption: { strong: {}, a: false },
      text: { strong: {} },
      source: 'plaintext',
      labels: false,
    };
  }

  private readonly data: Record<string, unknown>;

  public constructor(
    { data }: BlockToolConstructorOptions<Record<string, unknown>, Record<string, unknown>>
  ) {
    this.data = data;
  }

  public render(): HTMLDivElement {
    const element = document.createElement('div');

    element.textContent = typeof this.data.body === 'string' ? this.data.body : '';

    return element;
  }

  public save(): Record<string, unknown> {
    return this.data;
  }
}

class RichNote extends Paragraph {
  public static get richTextFields(): string[] {
    return ['text'];
  }
}

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null &&
  'markDestroyed' in value && typeof value.markDestroyed === 'function';

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const hasListeners = (value: unknown): value is { listeners: { removeAll(): void } } =>
  typeof value === 'object' && value !== null && 'listeners' in value &&
  typeof value.listeners === 'object' && value.listeners !== null &&
  'removeAll' in value.listeners && typeof value.listeners.removeAll === 'function';

const destroyCore = async (instance: Core): Promise<void> => {
  const modules: unknown[] = Object.values(instance.moduleInstances);
  const pending: Array<void | Promise<void>> = [];

  // All modules must stop async work before any destroy hook runs.
  modules.filter(hasMarkDestroyed).forEach(module => module.markDestroyed());

  for (const module of modules) {
    if (hasDestroy(module)) {
      pending.push(module.destroy());
    }
    if (hasListeners(module)) {
      module.listeners.removeAll();
    }
  }

  destroyTooltip();
  await Promise.all(pending);
};

const boot = async (
  options: Pick<BlokConfig, 'data' | 'sanitizer'> = {}
): Promise<BlokModules> => {
  if (holder === undefined) {
    throw new Error('The test holder is missing.');
  }
  if (core !== undefined) {
    throw new Error('The test editor is already booted.');
  }

  const instance = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    tools: {
      paragraph: { class: Paragraph },
      header: { class: Header },
      list: { class: List },
      fields: { class: DeclaredFieldsTool, inlineToolbar: false },
      note: { class: RichNote, inlineToolbar: false },
      database: { class: DatabaseTool },
      'database-row': { class: DatabaseRowTool },
    },
    data: { blocks: [] },
    ...options,
  });

  core = instance;
  await instance.isReady;

  return instance.moduleInstances;
};

describe('editor agent ports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await core.isReady.catch(() => undefined);
        await destroyCore(core);
      }
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
      vi.restoreAllMocks();
    }
  });

  it('reads declared rich fields from real adapters, not sanitizer field names', async () => {
    const fieldsFor = editorRichTextFieldsFor(await boot());

    expect(fieldsFor('fields')).toEqual(['body', 'caption']);
    expect(fieldsFor('paragraph')).toEqual(['text']);
    expect(fieldsFor('header')).toEqual(['text']);
    expect(fieldsFor('not-registered')).toEqual([]);
  }, 60_000);

  it('removes unsafe link marks without losing their text or allowed formatting', async () => {
    const ports = createEditorPorts(await boot());
    const text: RichText = [
      { text: 'x', marks: { link: { href: 'javascript:alert(1)' } } },
      { text: 'b', marks: { bold: true } },
      { text: 'safe', marks: { link: { href: 'https://example.test' } } },
    ];
    const data = { text };

    expect(ports.sanitizeBlockData('paragraph', data)).toEqual({
      text: [
        { text: 'x' },
        { text: 'b', marks: { bold: true } },
        { text: 'safe', marks: { link: { href: 'https://example.test' } } },
      ],
    });
    expect(data).toEqual({
      text: [
        { text: 'x', marks: { link: { href: 'javascript:alert(1)' } } },
        { text: 'b', marks: { bold: true } },
        { text: 'safe', marks: { link: { href: 'https://example.test' } } },
      ],
    });
  }, 60_000);

  it('runs the real tag allowlist before returning canonical segments', async () => {
    const ports = createEditorPorts(await boot());
    const out = ports.sanitizeBlockData('paragraph', {
      text: '<abbr title="secret">x</abbr><strong onclick="alert(1)">b</strong>' +
        '<iframe src="https://example.test" onload="alert(1)"></iframe>',
    });

    expect(out.text).toEqual([
      { text: 'x' },
      { text: 'b', marks: { bold: true } },
    ]);
  }, 60_000);

  it('does not parse a segment text value as markup or escape it twice', async () => {
    const ports = createEditorPorts(await boot());
    const text: RichText = [{ text: '<b>literal</b> & "quoted"', marks: { bold: true } }];

    expect(ports.sanitizeBlockData('paragraph', { text }).text).toEqual([
      { text: '<b>literal</b> & "quoted"', marks: { bold: true } },
    ]);
    expect(text).toEqual([
      { text: '<b>literal</b> & "quoted"', marks: { bold: true } },
    ]);
  }, 60_000);

  it('keeps adjacent page embeds as separate objects through real host sanitation', async () => {
    const ports = createEditorPorts(await boot());
    const text: RichText = [
      { text: 'See ' },
      { embed: { page: { id: 'page-1' } } },
      { embed: { page: { id: 'page-1' } } },
    ];

    expect(ports.sanitizeBlockData('paragraph', { text }).text).toEqual([
      { text: 'See ' },
      { embed: { page: { id: 'page-1' } } },
      { embed: { page: { id: 'page-1' } } },
    ]);
    expect(text).toEqual([
      { text: 'See ' },
      { embed: { page: { id: 'page-1' } } },
      { embed: { page: { id: 'page-1' } } },
    ]);
  }, 60_000);

  it('keeps the page ID but drops stale page metadata under a host anchor override', async () => {
    const sanitizer = { a: { href: true } };
    const ports = createEditorPorts(await boot({ sanitizer }));
    const stale = '<a data-blok-page-id="page-1" href="https://example.test/old"' +
      ' title="Old title" target="_blank" rel="nofollow"><strong>Old title</strong></a>';
    const out = ports.sanitizeBlockData('paragraph', { text: stale });

    expect(out.text).toEqual([{ embed: { page: { id: 'page-1' } } }]);
    expect(sanitizer).toEqual({ a: { href: true } });
  }, 60_000);

  it('still applies the host anchor override to ordinary links', async () => {
    const ports = createEditorPorts(await boot({ sanitizer: { a: { href: true } } }));
    const out = ports.sanitizeBlockData('paragraph', {
      text: '<a href="https://example.test" target="_blank" rel="nofollow" onclick="alert(1)">Site</a>',
    });

    expect(out.text).toEqual([
      { text: 'Site', marks: { link: { href: 'https://example.test' } } },
    ]);
  }, 60_000);

  it('does not preserve page embeds in a rich field whose tool denies anchors', async () => {
    const ports = createEditorPorts(await boot());
    const page: RichText = [{ embed: { page: { id: 'page-1' } } }];
    const out = ports.sanitizeBlockData('fields', { body: page, caption: page });

    expect(out.caption).toEqual([{ text: 'Page' }]);
    expect(out.body).toEqual([{ embed: { page: { id: 'page-1' } } }]);
    expect(page).toEqual([{ embed: { page: { id: 'page-1' } } }]);
  }, 60_000);

  it('converts only declared rich fields and keeps metadata and plaintext in their own dialect', async () => {
    const ports = createEditorPorts(await boot({ sanitizer: { i: true } }));
    const body: RichText = [
      { text: 'bold', marks: { bold: true } },
      { text: 'italic', marks: { italic: true } },
    ];
    const source = 'a < b & c </tag> <a href="javascript:x">source</a>';
    const out = ports.sanitizeBlockData('fields', {
      body,
      caption: '<strong>Caption</strong>',
      text: '<strong>Metadata</strong>',
      source,
      labels: ['one', 'two'],
      count: 2,
    });

    expect(out).toEqual({
      body: [
        { text: 'bold', marks: { bold: true } },
        { text: 'italic', marks: { italic: true } },
      ],
      caption: [{ text: 'Caption', marks: { bold: true } }],
      text: '<strong>Metadata</strong>',
      source,
      labels: ['one', 'two'],
      count: 2,
    });
    expect(body).toEqual([
      { text: 'bold', marks: { bold: true } },
      { text: 'italic', marks: { italic: true } },
    ]);
  }, 60_000);

  it('round-trips Markdown heading marks as segments', async () => {
    const ports = createEditorPorts(await boot());
    const imported = await ports.markdownToBlocks('# Hi **there**');
    const exported = ports.blocksToMarkdown({ blocks: imported.blocks });

    expect(imported.blocks).toMatchObject([{
      type: 'header',
      data: {
        text: [{ text: 'Hi ' }, { text: 'there', marks: { bold: true } }],
        level: 1,
      },
    }]);
    expect(exported.markdown).toBe('# Hi **there**');
    expect(imported.warnings).toEqual([]);
    expect(exported.warnings).toEqual([]);
  }, 60_000);

  it('imports segment text and reports raw HTML degradation with a nonempty warning', async () => {
    const ports = createEditorPorts(await boot());
    const result = await ports.markdownToBlocks('**hi**\n\n<div>x</div>');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings).toEqual([{
      code: 'MARKDOWN_DEGRADED',
      message: 'html degraded: HTML is escaped and stored as literal text; Blok has no raw-HTML block',
    }]);
    expect(result.blocks).toMatchObject([
      { type: 'paragraph', data: { text: [{ text: 'hi', marks: { bold: true } }] } },
      { type: 'paragraph', data: { text: [{ text: '<div>x</div>' }] } },
    ]);
  }, 60_000);

  it('exports segment marks and reports underline degradation with a nonempty warning', async () => {
    const ports = createEditorPorts(await boot());
    const doc: OutputData = { blocks: [{
      id: 'p',
      type: 'paragraph',
      data: { text: [
        { text: 'hi', marks: { bold: true } },
        { text: 'low', marks: { underline: true } },
      ] },
    }] };
    const result = ports.blocksToMarkdown(doc);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings).toEqual([{
      code: 'MARKDOWN_DEGRADED',
      message: 'underline degraded: inline underline has no Markdown equivalent; the text is kept as ordinary text',
    }]);
    expect(result.markdown).toBe('**hi**low');
    expect(doc.blocks[0]?.data.text).toEqual([
      { text: 'hi', marks: { bold: true } },
      { text: 'low', marks: { underline: true } },
    ]);
  }, 60_000);

  it('reports a registered custom block whose content has no Markdown representation', async () => {
    const ports = createEditorPorts(await boot());
    const result = ports.blocksToMarkdown({ blocks: [{
      id: 'custom',
      type: 'fields',
      data: { body: [{ text: 'custom body' }] },
    }] });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings).toEqual([{
      code: 'MARKDOWN_DEGRADED',
      message: 'fields dropped: `fields` has no Markdown representation and carries no inline text',
    }]);
    expect(result.markdown).toBe('');
  }, 60_000);

  it('matches real host export without turning structural nesting into a code block', async () => {
    const doc: OutputData = { blocks: [
      {
        id: 'root',
        type: 'paragraph',
        data: { text: [{ text: 'root' }] },
        content: ['child'],
      },
      {
        id: 'child',
        type: 'paragraph',
        data: { text: [{ text: 'nested', marks: { bold: true } }] },
        parent: 'root',
      },
    ] };
    const modules = await boot({ data: doc });
    const result = createEditorPorts(modules).blocksToMarkdown(doc);

    expect(result.markdown).toBe('root\n\n**nested**');
    expect(result.markdown).toBe(await modules.BlocksAPI.exportMarkdown());
    expect(result.warnings).toEqual([]);
  }, 60_000);

  it('matches real host export for structurally nested list items without legacy depth', async () => {
    const doc: OutputData = { blocks: [
      {
        id: 'list-root',
        type: 'list',
        data: { text: [{ text: 'outer' }], style: 'unordered' },
        content: ['list-child'],
      },
      {
        id: 'list-child',
        type: 'list',
        data: { text: [{ text: 'inner' }], style: 'unordered' },
        parent: 'list-root',
      },
    ] };
    const modules = await boot({ data: doc });
    const result = createEditorPorts(modules).blocksToMarkdown(doc);

    expect(result.markdown).toBe('- outer\n    - inner');
    expect(result.markdown).toBe(await modules.BlocksAPI.exportMarkdown());
    expect(result.warnings).toEqual([]);
  }, 60_000);

  it('parses inline HTML into canonical segments and uses the existing block-ID format', async () => {
    const ports = createEditorPorts(await boot());

    expect(ports.htmlToSegments('a <strong>b</strong><br>c')).toEqual([
      { text: 'a ' },
      { text: 'b', marks: { bold: true } },
      { text: '\nc' },
    ]);
    expect(ports.newId()).toMatch(/^[A-Za-z0-9_-]{10}$/);
  }, 60_000);

  it('exports a declared custom text field with the same Markdown report in both runtimes', async () => {
    const customTools: BlokCustomToolsFile = {
      formatVersion: 1,
      blocks: [{
        name: 'note',
        description: {
          summary: 'A rich note.',
          data: { type: 'object', properties: { text: { type: 'array' } }, required: ['text'] },
        },
        statics: {
          toolbox: [],
          richTextFields: ['text'],
          acceptsChildren: true,
          ownsChildren: false,
          isLayout: false,
          deletesChildren: false,
          selfPlacesChildren: false,
          restrictedInTableCell: false,
          conversion: {},
          convertible: { import: false, export: false },
          hasPrepareInsert: false,
        },
        sanitize: { text: { strong: true } },
      }],
    };
    const doc: OutputData = { blocks: [{
      id: 'note-1',
      type: 'note',
      data: { text: [{ text: 'custom', marks: { bold: true } }] },
    }] };
    const modules = await boot({ data: structuredClone(doc) });
    const setup = createHeadlessAgentSetup({ customTools: readCustomToolsFile(customTools) });
    const expected = { markdown: '**custom**', warnings: [] };

    expect({
      headless: setup.ports.blocksToMarkdown(doc),
      editor: createEditorPorts(modules).blocksToMarkdown(doc),
      host: await modules.BlocksAPI.exportMarkdown(),
    }).toEqual({ headless: expected, editor: expected, host: '**custom**' });
  }, 60_000);

  it('returns marked segments from sanitation of a row rich-text property document', async () => {
    const modules = await boot();
    const data: DatabaseRowData = {
      position: 'a0',
      properties: {
        notes: { blocks: [{
          id: 'nested-1',
          type: 'paragraph',
          data: { text: [{ text: 'x', marks: { italic: true } }] },
        }] },
      },
    };

    expect(createEditorPorts(modules).sanitizeBlockData('database-row', structuredClone(data)))
      .toEqual(data);
  }, 60_000);

  it('reads stored row rich-text property HTML as segments in the editor snapshot output', async () => {
    const database: DatabaseData = {
      schema: [
        { id: 'title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'notes', name: 'Notes', type: 'richText', position: 'a1' },
      ],
      views: [{
        id: 'view-1',
        name: 'List',
        type: 'list',
        position: 'a0',
        sorts: [],
        filters: [],
        visibleProperties: ['notes'],
      }],
      activeViewId: 'view-1',
    };
    const row: DatabaseRowData = {
      position: 'a0',
      properties: {
        title: 'Row',
        notes: { blocks: [{
          id: 'nested-1',
          type: 'paragraph',
          data: { text: '<i>x</i>' },
        }] },
      },
    };
    const modules = await boot({ data: { blocks: [
      { id: 'database-1', type: 'database', data: database, content: ['row-1'] },
      { id: 'row-1', type: 'database-row', data: row, parent: 'database-1' },
    ] } });
    const snapshotRow = editorSnapshot(modules).toOutput().blocks.find(block => block.id === 'row-1');

    expect({ type: snapshotRow?.type, properties: snapshotRow?.data.properties }).toEqual({
      type: 'database-row',
      properties: {
        title: 'Row',
        notes: { blocks: [{
          id: 'nested-1',
          type: 'paragraph',
          data: { text: [{ text: 'x', marks: { italic: true } }] },
        }] },
      },
    });
  }, 60_000);
});
