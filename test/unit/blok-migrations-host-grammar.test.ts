import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { CalloutTool } from '../../src/tools/callout';
import { migrateLegacyBlocks } from '../../src/migrate';
import type { OutputBlockData, OutputData } from '../../types';

/**
 * A host grammar entry is a STRUCTURAL rule (type change + 1:N split), which the
 * data-only `config.migrations` map cannot express. Inside an editor, the
 * supported way to apply one at load is `onBeforeRender` — it runs on the raw
 * saved shape, before format analysis and before hierarchical expansion, so the
 * blocks it returns are what the rest of the load path sees.
 *
 * This proves that composition end-to-end: a legacy `alert` the editor knows
 * nothing about arrives as a real `callout` with a parented child paragraph.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const alertRule = {
  legacyType: 'alert',
  targetType: 'callout',
  cardinality: '1:N' as const,
  contributesNesting: true,
  lossyFields: [],
  docNote: 'Host rule: `alert` → `callout` + message paragraph.',
  detect: (block: OutputBlockData) => block.type === 'alert',
  expand: (block: OutputBlockData, ctx: { generateId: () => string }) => {
    const calloutId = block.id ?? ctx.generateId();
    const childId = ctx.generateId();

    return [
      {
        id: calloutId,
        type: 'callout',
        data: { emoji: '🚨', textColor: null, backgroundColor: 'red' },
        content: [childId],
      },
      {
        id: childId,
        type: 'paragraph',
        data: { text: String(block.data.message) },
        parent: calloutId,
      },
    ];
  },
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('host grammar rules at editor load (onBeforeRender)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('renders and saves a legacy type the editor has no tool for', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, callout: CalloutTool },
      onBeforeRender: (blocks) => migrateLegacyBlocks(blocks, { rules: [alertRule] }),
      data: {
        blocks: [{ id: 'a1', type: 'alert', data: { message: 'disk almost full' } }],
      },
    }) as unknown as TestEditor;

    editor = instance;

    await instance.isReady;

    const saved = await instance.save();
    const callout = saved.blocks.find((block) => block.type === 'callout');
    const paragraph = saved.blocks.find((block) => block.type === 'paragraph');

    // The unknown legacy type never reached the tool registry as a stub…
    expect(saved.blocks.some((block) => block.type === 'alert')).toBe(false);
    // …it became a real callout with the message as a parented child block.
    expect(callout?.id).toBe('a1');
    expect(paragraph?.data.text).toBe('disk almost full');
    expect(paragraph?.parent).toBe('a1');
    expect(callout?.content).toEqual([paragraph?.id]);
  }, 60_000);
});
