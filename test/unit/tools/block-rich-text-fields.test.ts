import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { API, BlockToolConstructable, SanitizerConfig } from '@/types';
import { BlockToolAdapter } from '../../../src/components/tools/block';
import { InlineToolAdapter } from '../../../src/components/tools/inline';
import { ToolsCollection } from '../../../src/components/tools/collection';

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
    constructable: Object.assign(class {}, { sanitize: { b: true, strong: true }, isInline: true }) as unknown as BlockToolAdapterOptions['constructable'],
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

  it('lists fields whose own sanitize rule is a tag map', () => {
    expect(createAdapter().richTextFields).toEqual(['text']);
  });

  it('lists nothing for a tool without its own sanitize config', () => {
    const adapter = createAdapter({ constructable: createConstructable() });

    // Its merged config is the flat inline-tool tag map; tag names are not fields.
    expect(Object.keys(adapter.sanitizeConfig)).toContain('b');
    expect(adapter.richTextFields).toEqual([]);
  });

  it('lets a static richTextFields on the tool win over the sanitize rules', () => {
    const constructable = Object.assign(createConstructable({ content: { b: true } }), { richTextFields: [] });

    expect(createAdapter({ constructable }).richTextFields).toEqual([]);
  });

  it('reports the configured output format, html by default', () => {
    expect(createAdapter().richTextFormat).toBe('html');
    expect(createAdapter({ richTextFormat: 'segments' }).richTextFormat).toBe('segments');
  });
});
