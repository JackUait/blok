/**
 * A rounded block's selection fill follows its frame: the tool declares
 * `static frameRadius`, core writes it on the content wrapper as
 * `--blok-radius-frame`, and the fill's radius reads it (spec §5.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Block } from '../../../../src/components/block';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { ToolsCollection } from '../../../../src/components/tools/collection';
import type { API as ApiModules } from '../../../../src/components/modules/api';
import type { API, BlockToolConstructable } from '@/types';

const FILL_RADIUS_CLASS = 'rounded-(--blok-radius-frame,var(--blok-radius-control))';

const makeTool = (statics: Record<string, unknown> = {}): BlockToolConstructable => {
  class FramedTool {
    public render(): HTMLElement {
      return document.createElement('div');
    }

    public save(): Record<string, never> {
      return {};
    }
  }

  return Object.assign(FramedTool, statics);
};

const makeBlock = (constructable: BlockToolConstructable): Block => {
  const tool = new BlockToolAdapter({
    name: 'framed',
    constructable,
    config: {},
    api: {} as API,
    isDefault: false,
    isInternal: false,
    defaultPlaceholder: undefined,
  });

  tool.tunes = new ToolsCollection();

  return new Block({
    id: 'framed-block',
    data: {},
    tool,
    readOnly: false,
    tunesData: {},
    api: {} as ApiModules,
  });
};

const contentOf = (block: Block): HTMLElement => {
  const content = block.holder.querySelector<HTMLElement>('[data-blok-element-content]');

  if (content === null) {
    throw new Error('block has no content wrapper');
  }

  return content;
};

describe('selection fill follows the block frame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('writes the declared frame radius on the content wrapper', () => {
    const block = makeBlock(makeTool({ frameRadius: 'var(--blok-radius-block)' }));

    expect(contentOf(block).style.getPropertyValue('--blok-radius-frame')).toBe('var(--blok-radius-block)');
  });

  it('writes no frame radius for a tool that declares none', () => {
    const block = makeBlock(makeTool());

    expect(contentOf(block).style.getPropertyValue('--blok-radius-frame')).toBe('');
  });

  it('rounds the selection fill from the frame, keeping the frame through select and unselect', () => {
    const block = makeBlock(makeTool({ frameRadius: 'var(--blok-radius-block)' }));
    const content = contentOf(block);

    block.selected = true;

    expect(content.classList.contains('bg-selection')).toBe(true);
    expect(content.classList.contains(FILL_RADIUS_CLASS)).toBe(true);
    expect(content.style.getPropertyValue('--blok-radius-frame')).toBe('var(--blok-radius-block)');

    block.selected = false;

    expect(content.classList.contains(FILL_RADIUS_CLASS)).toBe(false);
    expect(content.style.getPropertyValue('--blok-radius-frame')).toBe('var(--blok-radius-block)');
  });
});
