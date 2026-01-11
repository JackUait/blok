import { expect, test } from '@playwright/test';
import { Paragraph } from '../../../../src/tools/paragraph';
import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import { DeleteTune } from '../../../../src/components/block-tunes/block-tune-delete';
import { ToolsFactory } from '../../../../src/components/tools/factory';
import { InlineToolAdapter } from '../../../../src/components/tools/inline';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { BlockTuneAdapter } from '../../../../src/components/tools/tune';
import type { API as ApiModule } from '../../../../src/components/modules/api';
import type {
  BlockToolConstructable,
  ToolConstructable,
  ToolSettings
} from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

const paragraphClass = Paragraph as unknown as BlockToolConstructable;

const toolsConfig = {
  paragraph: {
    class: paragraphClass,
  },
  link: {
    class: LinkInlineTool,
  },
  delete: {
    class: DeleteTune,
  },
} as Record<string, ToolSettings & { class: ToolConstructable; isInternal?: boolean }>;

const blokConfig: BlokConfig = {
  placeholder: 'Placeholder',
  defaultBlock: 'paragraph',
};

type ToolApiMethods = ApiModule['methods'];

const apiMethodsStub: ToolApiMethods = {
  blocks: {} as ToolApiMethods['blocks'],
  caret: {} as ToolApiMethods['caret'],
  tools: {} as ToolApiMethods['tools'],
  events: {} as ToolApiMethods['events'],
  listeners: {} as ToolApiMethods['listeners'],
  notifier: {} as ToolApiMethods['notifier'],
  sanitizer: {} as ToolApiMethods['sanitizer'],
  saver: {} as ToolApiMethods['saver'],
  selection: {} as ToolApiMethods['selection'],
  styles: {} as ToolApiMethods['styles'],
  toolbar: {} as ToolApiMethods['toolbar'],
  inlineToolbar: {} as ToolApiMethods['inlineToolbar'],
  tooltip: {} as ToolApiMethods['tooltip'],
  i18n: {} as ToolApiMethods['i18n'],
  readOnly: {} as ToolApiMethods['readOnly'],
  ui: {} as ToolApiMethods['ui'],
};

const apiMock: Pick<ApiModule, 'methods'> = {
  get methods() {
    return apiMethodsStub;
  },
};

test.describe('toolsFactory', () => {
  let factory: ToolsFactory;

  test.beforeEach(() => {
    factory = new ToolsFactory(
      toolsConfig,
      blokConfig,
      apiMock as unknown as ApiModule
    );
  });

  test('.get returns appropriate tool object', () => {
    const tool = factory.get('link');

    expect(tool.name).toBe('link');
  });

  test('.get returns InlineTool object for inline tool', () => {
    const tool = factory.get('link');

    expect(tool).toBeInstanceOf(InlineToolAdapter);
  });

  test('.get returns BlockTool object for block tool', () => {
    const tool = factory.get('paragraph');

    expect(tool).toBeInstanceOf(BlockToolAdapter);
  });

  test('.get returns BlockTune object for tune', () => {
    const tool = factory.get('delete');

    expect(tool).toBeInstanceOf(BlockTuneAdapter);
  });
});


