import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PopoverDesktopParams } from '../../../../src/components/utils/popover/popover-desktop';

const { seen } = vi.hoisted(() => ({ seen: [] as PopoverDesktopParams[] }));

vi.mock('../../../../src/components/utils/popover', async (importOriginal) => {
  const real = await importOriginal<{ PopoverDesktop: new (params: PopoverDesktopParams) => Record<string, unknown> }>();

  class RecordingPopover extends real.PopoverDesktop {
    constructor(params: PopoverDesktopParams) {
      seen.push(params);
      super(params);
    }
  }

  return { ...real, PopoverDesktop: RecordingPopover };
});

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData } from '../../../../types';

/**
 * notion-motion.md Round 52 §1 "Chip click": a list row's Status editor opens
 * 1px left of the chip and, with no room below, above it, its bottom 1 over the
 * chip's top. Only the list chip was measured; the board card keeps its place.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

const CHIP = new DOMRect(1113, 441, 118, 30);

const doc = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
      ],
      views: [{ id: 'v', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: ['s'], ...view }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', s: 'o1' }, position: 'a0' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const openChip = async (view: Record<string, unknown>, selector: string): Promise<PopoverDesktopParams | undefined> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: doc(view) },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
  const chip = holder?.querySelector<HTMLElement>(selector);

  if (chip === null || chip === undefined) {
    return undefined;
  }
  chip.getBoundingClientRect = () => CHIP;
  seen.length = 0;
  chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();

  return seen.find((params) => String(params.class ?? '').includes('blok-database-cell-editor'));
};

describe('list chip editor side', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a list chip\'s editor sits 1px left of the chip and may open above it, 1 over its top', async () => {
    const params = await openChip({ type: 'list' }, '[data-blok-database-list-row][data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="s"]');

    expect(params?.coverFlipOffset).toBe(CHIP.height + 8 + 1);
    expect(params?.position?.x).toBe(CHIP.x - 1);
    expect(params?.position?.y).toBe(CHIP.bottom + 8);
  });

  it('a board card\'s editor keeps its place under the value', async () => {
    const params = await openChip({ type: 'board', groupBy: 's' }, '[data-blok-database-card][data-row-id="r1"] [data-blok-database-card-property][data-property-id="s"]');

    expect(params).toBeDefined();
    expect(params?.coverFlipOffset).toBeUndefined();
    expect(params?.position?.x).toBe(CHIP.x);
  });
});
