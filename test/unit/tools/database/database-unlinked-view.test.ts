import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
import { IconFolderQuestion, IconTable } from '../../../../src/components/icons';
import { buildDatabase, makeDoc } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const normalized = (markup: string): string => {
  const span = document.createElement('span');

  span.innerHTML = markup;

  return span.innerHTML;
};

const unlinked = (): HTMLElement => {
  const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);

  return buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData).el;
};

describe('a linked view with no source yet (findings-creation N18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('marks the block so its title and toolbar hide', () => {
    expect(unlinked().hasAttribute('data-blok-database-unlinked')).toBe(true);
  });

  it('shows a Table view pill, the folder glyph, "New table" and the button, in that order', () => {
    const picker = unlinked().querySelector('[data-blok-database-source-picker]');
    const pill = picker?.querySelector('[data-blok-database-source-picker-pill]');
    const glyph = picker?.querySelector('[data-blok-database-source-picker-glyph]');
    const caption = picker?.querySelector('[data-blok-database-source-picker-caption]');
    const button = picker?.querySelector('button');

    expect(pill?.textContent?.trim()).toBe('tools.database.viewTypeTable');
    expect(pill?.querySelector('svg')?.outerHTML).toBe(normalized(IconTable).trim());
    expect(glyph?.innerHTML).toBe(normalized(IconFolderQuestion));
    expect(caption?.textContent).toBe('tools.database.csvNewTable');
    expect(button?.textContent).toBe('tools.database.linkedLinkSource');
    expect([pill, glyph, caption, button].map((node) => node?.parentElement === picker || node?.parentElement?.parentElement === picker)).toEqual([true, true, true, true]);
  });
});
