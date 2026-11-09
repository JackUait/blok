/**
 * A database panel (Filter, Sort…) opens under its button and slides up only
 * as far as it must to stay 12px inside the window, like view settings does
 * (side-by-side-v1.md "Filter / Sort popovers": Notion fits the card, Blok ran
 * 37px past a 717px window).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PopoverParams } from '../../../../../types/utils/popover/popover';

const { seen } = vi.hoisted(() => ({ seen: [] as PopoverParams[] }));

vi.mock('../../../../../src/components/utils/popover', async (importOriginal) => {
  const real = await importOriginal<{ PopoverDesktop: new (params: PopoverParams) => Record<string, unknown> }>();

  class RecordingPopover extends real.PopoverDesktop {
    constructor(params: PopoverParams) {
      seen.push(params);
      super(params);
    }
  }

  return { ...real, PopoverDesktop: RecordingPopover };
});

import { CellPopover } from '../../../../../src/tools/database/cells/cell-popover';

const anchorAt = (rect: DOMRect): HTMLElement => {
  const anchor = document.createElement('button');

  anchor.getBoundingClientRect = () => rect;
  document.body.appendChild(anchor);

  return anchor;
};

describe('CellPopover placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seen.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens a panel 8px under its button and lets it slide to stay 12px inside the window', () => {
    const anchor = anchorAt(new DOMRect(1193, 262, 28, 28));
    const popover = new CellPopover({ anchor, content: document.createElement('div'), onEscape: vi.fn(), onDismiss: vi.fn() });

    popover.show();

    const params = seen[0];

    expect(params.cover).toBe(true);
    expect(params.viewportMargin).toBe(12);
    expect(params.positionContext).toBe(anchor);
    expect(params.position?.x).toBe(1193);
    expect(params.position?.y).toBe(262 + 28 + 8);
    expect(params.position?.width).toBe(28);
    popover.close();
  });
});
