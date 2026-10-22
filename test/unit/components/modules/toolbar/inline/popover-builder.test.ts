import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { InlinePopoverBuilder } from '../../../../../../src/components/modules/toolbar/inline/popover-builder';
import { PopoverItemType } from '../../../../../../src/components/utils/popover';

import type { I18n } from '../../../../../../src/components/modules/i18n';
import type { InlineToolAdapter } from '../../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { InlineTool as IInlineTool, PopoverItemParams } from '@/types';

const adapter = (name: string): InlineToolAdapter => ({ name, title: name, titleKey: undefined }) as unknown as InlineToolAdapter;

const build = (tools: Array<[string, PopoverItemParams]>): Promise<PopoverItemParams[]> => {
  const getBlok = (): BlokModules => ({ Tools: { inlineTools: new Map() } }) as unknown as BlokModules;
  const i18n = { t: (key: string): string => key, has: (): boolean => false } as unknown as I18n;
  const items = new Map<InlineToolAdapter, IInlineTool>(
    tools.map(([name, rendered]) => [adapter(name), { render: () => rendered }])
  );

  return new InlinePopoverBuilder(getBlok, () => i18n).build(items);
};

const askAiRow = (): PopoverItemParams => ({ type: PopoverItemType.Html, element: document.createElement('div'), name: 'askAi' });
const bold = (): PopoverItemParams => ({ icon: 'B', onActivate: () => undefined });

describe('InlinePopoverBuilder — Ask AI row', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('rules the Ask AI row off from the tools above it', async () => {
    const items = await build([['bold', bold()], ['askAi', askAiRow()]]);

    expect(items.map((item) => item.type)).toEqual([
      PopoverItemType.Default,
      PopoverItemType.Separator,
      PopoverItemType.Html,
    ]);
  });

  it('draws no rule when Ask AI is the only item', async () => {
    const items = await build([['askAi', askAiRow()]]);

    expect(items.map((item) => item.type)).toEqual([PopoverItemType.Html]);
  });

  // The row shows its label, so a hover hint over it only repeats it.
  it('gives the Ask AI row no hint', async () => {
    const [item] = await build([['askAi', askAiRow()]]);

    expect('hint' in item ? item.hint : undefined).toBeUndefined();
  });
});
