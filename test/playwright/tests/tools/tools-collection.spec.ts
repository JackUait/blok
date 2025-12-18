import { expect, test } from '@playwright/test';
import type { ToolClass } from '../../../../src/components/tools/collection';
import { ToolsCollection } from '../../../../src/components/tools/collection';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { InlineToolAdapter } from '../../../../src/components/tools/inline';
import type { BlockTuneAdapter } from '../../../../src/components/tools/tune';

type ToolStubOptions = {
  block?: boolean;
  inline?: boolean;
  tune?: boolean;
  internal?: boolean;
};

const createToolStub = <T extends ToolClass>({
  block = false,
  inline = false,
  tune = false,
  internal = false,
}: ToolStubOptions = {}): T => ({
    isBlock: () => block,
    isInline: () => inline,
    isTune: () => tune,
    isInternal: internal,
  } as unknown as T);

const blockTool = createToolStub<BlockToolAdapter>({ block: true });
const inlineTool = createToolStub<InlineToolAdapter>({ inline: true });
const blockTune = createToolStub<BlockTuneAdapter>({ tune: true });
const internalBlockTool = createToolStub<BlockToolAdapter>({ block: true,
  internal: true });
const internalInlineTool = createToolStub<InlineToolAdapter>({ inline: true,
  internal: true });
const internalBlockTune = createToolStub<BlockTuneAdapter>({ tune: true,
  internal: true });

const fakeTools: Array<[string, ToolClass]> = [
  ['block1', blockTool],
  ['inline1', inlineTool],
  ['block2', internalBlockTool],
  ['tune1', blockTune],
  ['block3', blockTool],
  ['inline2', internalInlineTool],
  ['tune2', blockTune],
  ['tune3', internalBlockTune],
  ['block3', inlineTool],
  ['block4', blockTool],
];

test.describe('toolsCollection', () => {
  let collection: ToolsCollection;

  test.beforeEach(() => {
    collection = new ToolsCollection(fakeTools);
  });

  test('should be instance of Map', () => {
    expect(collection).toBeInstanceOf(Map);
  });

  test.describe('.blockTools', () => {
    test('should return new instance of ToolsCollection', () => {
      expect(collection.blockTools).toBeInstanceOf(ToolsCollection);
    });

    test('result should contain only block tools', () => {
      const values = Array.from(collection.blockTools.values());

      expect(values.every((tool: BlockToolAdapter) => tool.isBlock())).toBe(true);
    });
  });

  test.describe('.inlineTools', () => {
    test('should return new instance of ToolsCollection', () => {
      expect(collection.inlineTools).toBeInstanceOf(ToolsCollection);
    });

    test('result should contain only inline tools', () => {
      const values = Array.from(collection.inlineTools.values());

      expect(values.every((tool: InlineToolAdapter) => tool.isInline())).toBe(true);
    });
  });

  test.describe('.blockTunes', () => {
    test('should return new instance of ToolsCollection', () => {
      expect(collection.blockTunes).toBeInstanceOf(ToolsCollection);
    });

    test('result should contain only block tunes', () => {
      const values = Array.from(collection.blockTunes.values());

      expect(values.every((tool: BlockTuneAdapter) => tool.isTune())).toBe(true);
    });
  });

  test.describe('.internalTools', () => {
    test('should return new instance of ToolsCollection', () => {
      expect(collection.internalTools).toBeInstanceOf(ToolsCollection);
    });

    test('result should contain only internal tools', () => {
      const values = Array.from(collection.internalTools.values());

      expect(values.every((tool) => tool.isInternal)).toBe(true);
    });
  });

  test.describe('.externalTools', () => {
    test('should return new instance of ToolsCollection', () => {
      expect(collection.externalTools).toBeInstanceOf(ToolsCollection);
    });

    test('result should contain only external tools', () => {
      const values = Array.from(collection.externalTools.values());

      expect(values.every((tool) => !tool.isInternal)).toBe(true);
    });
  });

  test.describe('mixed access', () => {
    test.describe('.blockTunes.internalTools', () => {
      test('should return only internal tunes', () => {
        const values = Array.from(collection.blockTunes.internalTools.values());

        expect(values.every((tool: BlockTuneAdapter) => tool.isTune() && tool.isInternal)).toBe(true);
      });
    });

    test.describe('.externalTools.blockTools', () => {
      test('should return only external block tools', () => {
        const values = Array.from(collection.externalTools.blockTools.values());

        expect(values.every((tool: BlockToolAdapter) => tool.isBlock() && !tool.isInternal)).toBe(true);
      });
    });
  });
});

