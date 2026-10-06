import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData } from '../../../../../types';
import { boot, viewTable, type Booted } from './roundtrip-harness';

/** Valid CSS colours a stored document (hand-written, imported, older client) may carry. */
const COLOURS = ['red', 'rgb(1 2 3)', 'rgb(1 2 3 / 50%)', 'hsl(10 20% 30%)', 'var(--blok-color-red-bg)', '#FBECDD'];

describe('stored cell colours survive load → save', () => {
  let booted: Booted | null = null;

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
  });

  for (const colour of COLOURS) {
    it(`keeps background and text colour ${colour}`, async () => {
      booted = await boot({
        blocks: [
          { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'], color: colour, textColor: colour }, { blocks: ['b'] }]] } },
          { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
          { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
        ] as OutputBlockData[],
      });
      const cell = viewTable(await booted.editor.save())?.grid[0][0];

      expect({ color: cell?.color, textColor: cell?.textColor }).toEqual({ color: colour, textColor: colour });
    });
  }
});
