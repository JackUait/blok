/**
 * notion-motion.md Round 41 Part A: Notion's table header row ends with "+" and a "⋯"
 * ("Show or hide properties") that opens property visibility.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTool, makeDoc, tableData } from './tier3-harness';
import type { DatabaseTool } from '../../../../src/tools/database';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const built: DatabaseTool[] = [];

describe('DatabaseTool — the table header ⋯', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens the Property visibility page, whose eye hides a column', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, tableData());

    built.push(tool);
    el.querySelector<HTMLElement>('[data-blok-database-table-property-visibility]')?.click();

    const eye = document.querySelector<HTMLElement>('[data-blok-testid="database-property-visible-notes"]');

    expect(eye?.getAttribute('aria-checked')).toBe('true');
    eye?.click();
    expect(el.querySelector('[data-blok-database-table-column-header][data-property-id="notes"]')).toBeNull();
  });

  it('is not drawn in a read-only database', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, tableData(), true);

    built.push(tool);

    expect(el.querySelector('[data-blok-database-table-property-visibility]')).toBeNull();
  });
});
