import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { InlinePopoverBuilder } from '../../../../../../src/components/modules/toolbar/inline/popover-builder';

import type { I18n } from '../../../../../../src/components/modules/i18n';
import type { InlineToolAdapter } from '../../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { InlineTool as IInlineTool, PopoverItemParams } from '@/types';

/**
 * Mutant notes for src/components/modules/toolbar/inline/popover-builder.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

const onActivate = (): void => undefined;

const makeAdapter = (name: string, shortcut?: string): InlineToolAdapter => {
  const adapter: Pick<InlineToolAdapter, 'name' | 'title' | 'titleKey' | 'shortcut'> = {
    name,
    title: 'Bold',
    titleKey: undefined,
    shortcut,
  };

  return adapter as InlineToolAdapter;
};

const makeInstance = (): IInlineTool => {
  const rendered: PopoverItemParams = { icon: 'ICON',
    title: 'Bold',
    onActivate };
  return { render: () => rendered };
};

const buildWith = async (
  adapter: InlineToolAdapter,
  registry: Map<string, InlineToolAdapter>
): Promise<PopoverItemParams[]> => {
  const getBlok = (): BlokModules => ({ Tools: { inlineTools: registry } }) as unknown as BlokModules;
  const i18nStub: Pick<I18n, 't' | 'has'> = {
    t: (key: string): string => key,
    has: (): boolean => false,
  };
  const builder = new InlinePopoverBuilder(getBlok, () => i18nStub as I18n);

  return builder.build(new Map([[adapter, makeInstance()]]));
};

const hintOf = (item: PopoverItemParams): { title?: string; description?: string } => {
  if (!('hint' in item) || item.hint === undefined) {
    throw new Error('built item carries no hint');
  }

  return item.hint;
};

describe('InlinePopoverBuilder.build', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('describes the item with the registered shortcut', async () => {
    const adapter = makeAdapter('bold', 'SHIFT+K');
    const registry = new Map<string, InlineToolAdapter>([['bold', adapter]]);

    const [item] = await buildWith(adapter, registry);

    expect(hintOf(item)).toStrictEqual({ title: 'Bold',
      description: '⇧ + K' });
  });

  it('builds an item for a tool the registry does not know', async () => {
    const adapter = makeAdapter('bold', 'SHIFT+K');

    const [item] = await buildWith(adapter, new Map<string, InlineToolAdapter>());

    expect(hintOf(item)).toStrictEqual({ title: 'Bold',
      description: undefined });
  });
});
