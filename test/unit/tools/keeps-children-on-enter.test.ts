import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CalloutTool } from '../../../src/tools/callout';
import { Column } from '../../../src/tools/column';
import { ColumnList } from '../../../src/tools/column-list';
import { ToggleItem } from '../../../src/tools/toggle';

/**
 * `keepsChildrenOnEnter` is the per-tool declaration that decides whether Enter
 * on a container's empty LAST child creates the new line INSIDE the container or
 * escapes it. Core used to decide by comparing the parent's NAME against
 * 'column'/'column_list', which no host tool could ever join.
 *
 * These assertions pin the re-expression: Blok's own containers must declare the
 * flag (so the name comparison stays deleted), and the callout must NOT — Notion
 * parity says Enter on a callout's empty last line leaves the panel.
 */
describe('keepsChildrenOnEnter tool declaration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['Column', Column],
    ['ColumnList', ColumnList],
    ['ToggleItem', ToggleItem],
  ])('%s declares keepsChildrenOnEnter', (_name, tool) => {
    expect((tool as unknown as { keepsChildrenOnEnter?: boolean }).keepsChildrenOnEnter).toBe(true);
  });

  it('CalloutTool does not declare keepsChildrenOnEnter — Enter leaves the panel', () => {
    expect((CalloutTool as unknown as { keepsChildrenOnEnter?: boolean }).keepsChildrenOnEnter).toBeUndefined();
  });
});
