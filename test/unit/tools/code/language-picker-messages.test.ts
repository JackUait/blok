import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as PopoverModule from '../../../../src/components/utils/popover';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CodeData } from '../../../../types/tools/code';

const popoverMock = vi.hoisted(() => ({
  constructorParams: [] as unknown[],
}));

vi.mock('../../../../src/components/utils/popover', async (importOriginal) => {
  const actual = await importOriginal<typeof PopoverModule>();

  class MockPopoverDesktop {
    constructor(params: unknown) {
      popoverMock.constructorParams.push(params);
    }

    public on(): void {}
    public show(): void {}
    public hide(): void {}
    public destroy(): void {}
    public getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return {
    ...actual,
    PopoverDesktop: MockPopoverDesktop,
  };
});

import { CodeTool } from '../../../../src/tools/code';

const createMockAPI = (): API =>
  ({
    styles: { block: 'ce-block' },
    i18n: { t: (key: string) => key },
    blocks: {
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      insert: vi.fn(),
    },
  }) as unknown as API;

const createOptions = (): BlockToolConstructorOptions<CodeData> => ({
  data: { code: '', language: 'plain text' } as CodeData,
  config: {},
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'code-block-id' } as never,
});

type ToolWithPicker = {
  buildLanguagePicker(trigger: HTMLElement, leftAlignElement: HTMLElement): unknown;
};

describe('CodeTool language picker popover messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popoverMock.constructorParams.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes search, nothingFound and searchResults messages to the popover', () => {
    const tool = new CodeTool(createOptions());

    (tool as unknown as ToolWithPicker).buildLanguagePicker(
      document.createElement('button'),
      document.createElement('div')
    );

    expect(popoverMock.constructorParams).toHaveLength(1);

    const params = popoverMock.constructorParams[0] as {
      messages?: { search?: string; nothingFound?: string; searchResults?: string };
    };

    expect(params.messages?.search).toBe('tools.code.searchLanguage');
    expect(params.messages?.nothingFound).toBe('popover.nothingFound');
    expect(params.messages?.searchResults).toBe('a11y.searchResults');
  });
});
