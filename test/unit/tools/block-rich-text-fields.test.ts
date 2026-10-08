import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { API, BlockToolConstructable, MenuConfig, SanitizerConfig } from '@/types';
import { BlockToolAdapter } from '../../../src/components/tools/block';
import { InlineToolAdapter } from '../../../src/components/tools/inline';
import { ToolsCollection } from '../../../src/components/tools/collection';
import { CURRENT_RICH_TEXT_FIELDS, RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import * as builtInExports from '../../../src/tools';

type BlockToolAdapterOptions = ConstructorParameters<typeof BlockToolAdapter>[0];

const createConstructable = (sanitize?: SanitizerConfig): BlockToolConstructable => {
  class MockBlockTool {
    public render(): HTMLElement {
      return document.createElement('div');
    }

    public save(): Record<string, never> {
      return {};
    }
  }

  if (sanitize !== undefined) {
    Object.assign(MockBlockTool, { sanitize });
  }

  return MockBlockTool;
};

const createAdapter = (overrides: Partial<BlockToolAdapterOptions> = {}): BlockToolAdapter => {
  const adapter = new BlockToolAdapter({
    name: 'blockTool',
    constructable: createConstructable({ text: { b: true }, level: false, code: 'plaintext' }),
    config: {},
    api: {} as API,
    isDefault: false,
    isInternal: false,
    ...overrides,
  });

  // Enabled inline tools feed the merged sanitize config.
  const bold = new InlineToolAdapter({
    name: 'bold',
    constructable: Object.assign(class {
      public render(): MenuConfig {
        return [];
      }
    }, { sanitize: { b: true, strong: true }, isInline: true }),
    config: {},
    api: {} as API,
    isDefault: false,
    isInternal: false,
  });

  adapter.inlineTools = new ToolsCollection([ [ 'bold', bold ] ]);

  return adapter;
};

describe('BlockToolAdapter rich text fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists nothing for a tag-map sanitize rule the tool did not declare as rich text', () => {
    expect(createAdapter().richTextFields).toEqual([]);
  });

  it('lists the fields a static richTextFields declares', () => {
    const constructable = Object.assign(createConstructable({ text: { b: true } }), { richTextFields: ['text', 3] });

    expect(createAdapter({ constructable }).richTextFields).toEqual(['text']);
  });

  it('lists nothing for a tool without its own sanitize config', () => {
    const adapter = createAdapter({ constructable: createConstructable() });

    // Its merged config is the flat inline-tool tag map; tag names are not fields.
    expect(Object.keys(adapter.sanitizeConfig)).toContain('b');
    expect(adapter.richTextFields).toEqual([]);
  });

  it('lets a static empty richTextFields stand', () => {
    const constructable = Object.assign(createConstructable({ content: { b: true } }), { richTextFields: [] });

    expect(createAdapter({ constructable }).richTextFields).toEqual([]);
  });
});

describe('built-in tools and the tool-less field tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The view and @bloklabs/core/migrate have no tool classes and read the tables instead.
  const registeredName: Record<string, string> = {
    Paragraph: 'paragraph', Header: 'header', List: 'list', Toggle: 'toggle', Quote: 'quote',
  };
  const builtIns = Object.entries(builtInExports)
    .filter(([, value]) => typeof value === 'function' && typeof Reflect.get(value, 'prototype')?.render === 'function')
    .filter(([, value]) => Reflect.get(value, 'isInline') !== true)
    .map(([exportName, value]): [string, unknown] => [registeredName[exportName] ?? exportName, value]);

  it('finds every built-in block tool', () => {
    expect(builtIns.length).toBeGreaterThanOrEqual(25);
  });

  it.each(builtIns)('%s declares the fields migrate converts, and the view reads them', (name, constructable) => {
    const fields = createAdapter({ name, constructable: constructable as BlockToolConstructable }).richTextFields;

    expect(fields).toEqual(CURRENT_RICH_TEXT_FIELDS[name] ?? []);
    expect(RICH_TEXT_FIELDS[name] ?? []).toEqual(expect.arrayContaining(fields));
  });

  it('lists the current model\'s rich fields', () => {
    expect(CURRENT_RICH_TEXT_FIELDS).toEqual({
      paragraph: ['text'], header: ['text'], quote: ['text'], toggle: ['text'], list: ['text'],
    });
  });
});
