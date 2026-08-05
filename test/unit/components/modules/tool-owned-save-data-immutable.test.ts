/**
 * Core must never mutate an object a TOOL owns.
 *
 * The inbound direction (caller document data -> core) is pinned by
 * renderer-caller-data-immutable.test.ts. This file pins the OUTBOUND
 * direction: whatever a tool hands back from `save()` or from
 * `conversionConfig.import()` belongs to the tool. Framework adapters
 * (React/Vue/Angular) return a frozen mirror of their props from `save()`, so
 * any core code that writes into that object throws "object is not extensible"
 * and the whole gesture is lost.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Blok } from '../../../../src/blok';
import type { OutputData } from '../../../../types';
import type { Blocks } from '../../../../types/api';

/**
 * The blocks API is attached to the instance dynamically by exportAPI(),
 * so it is not part of the Blok class type.
 * @param editor - ready editor instance
 */
const blocksApiOf = (editor: Blok): Blocks => {
  return (editor as unknown as { blocks: Blocks }).blocks;
};

/**
 * A tool that behaves like an adapter-authored block: its data is a frozen
 * mirror, `save()` returns that mirror, and `conversionConfig.import()` builds
 * a frozen object too. It always renders visible text so the block never counts
 * as empty — the empty path already copied, the non-empty path did not.
 */
const FROZEN_TOOL = class FrozenTool {
  private data: Readonly<Record<string, unknown>>;

  constructor({ data }: { data: Record<string, unknown> }) {
    this.data = Object.freeze({ ...data,
      text: typeof data.text === 'string' ? data.text : '' });
  }

  public static get conversionConfig(): { export: string; import: (text: string) => Record<string, unknown> } {
    return {
      export: 'text',
      import: (text: string) => Object.freeze({ text }),
    };
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.textContent = typeof this.data.text === 'string' && this.data.text !== '' ? this.data.text : 'frozen';

    return wrapper;
  }

  public save(): Readonly<Record<string, unknown>> {
    return this.data;
  }
};

/**
 * Plain convertible source block, so the conversion test does not depend on
 * which first-party tools this unit environment registers.
 */
const SOURCE_TOOL = class SourceTool {
  private text: string;

  constructor({ data }: { data: Record<string, unknown> }) {
    this.text = typeof data.text === 'string' ? data.text : '';
  }

  public static get conversionConfig(): { export: string; import: string } {
    return {
      export: 'text',
      import: 'text',
    };
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.textContent = this.text;

    return wrapper;
  }

  public save(block: HTMLElement): Record<string, unknown> {
    return { text: block.textContent ?? '' };
  }
};

const buildDocument = (): OutputData => ({
  blocks: [
    {
      id: 'p1',
      type: 'source',
      data: { text: 'source text' },
    },
  ],
});

describe('tool-owned save data immutability', () => {
  let holder: HTMLElement;
  let editor: Blok | null = null;

  beforeEach(() => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    if (editor !== null) {
      await editor.isReady;
      editor.destroy();
      editor = null;
    }
    holder.remove();
  });

  const createEditor = (): Blok => {
    return new Blok({
      holder,
      tools: { frozen: FROZEN_TOOL,
        source: SOURCE_TOOL },
      data: buildDocument(),
    });
  };

  it('composeBlockData never hands back the tool-owned frozen object', async () => {
    editor = createEditor();
    await editor.isReady;

    const composed = await blocksApiOf(editor).composeBlockData('frozen');

    expect(composed).toEqual({ text: '' });
    expect(Object.isExtensible(composed)).toBe(true);
  });

  it('composed block data can be merged into by the toolbox data channel', async () => {
    editor = createEditor();
    await editor.isReady;

    const composed = await blocksApiOf(editor).composeBlockData('frozen');

    expect(() => Object.assign(composed, { seedDefaults: true })).not.toThrow();
  });

  it('convert() with data overrides accepts a frozen conversionConfig.import result', async () => {
    editor = createEditor();
    await editor.isReady;

    const converted = await blocksApiOf(editor).convert('p1', 'frozen', { seedDefaults: true });

    expect(converted.name).toBe('frozen');
    await expect(converted.save()).resolves.toMatchObject({
      data: { text: 'source text',
        seedDefaults: true },
    });
  });
});
