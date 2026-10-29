import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sheetsOfTools, toolSheets } from '../../../../src/components/utils/lazy-styles';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';

describe('database stylesheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['database', DatabaseTool],
    ['database-row', DatabaseRowTool],
  ])('%s declares the database sheet, so core loads it before its blocks render', (_name, tool) => {
    expect(toolSheets(tool)).toEqual(['database']);
  });

  it('a host subclass keeps the sheet, even with a prepare of its own', () => {
    class HostDatabase extends DatabaseTool {
      public static prepare(): void {
        // A host hook that does not call super.
      }
    }

    expect(toolSheets(HostDatabase)).toEqual(['database']);
  });

  it('a lone row tool in the config is enough to load the sheet', () => {
    expect(sheetsOfTools({ 'database-row': { class: DatabaseRowTool } })).toEqual(['database']);
  });
});
