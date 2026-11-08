/**
 * The toolbar's icon buttons name themselves on hover, like Notion's "Filter",
 * "Sort" and "Settings" hints (notion-motion.md "Popovers", "Tooltip delay").
 * Blok waits its usual hint delay (tooltip.ts), so the hint goes through onHover.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { onHover } = vi.hoisted(() => ({ onHover: vi.fn() }));

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  onHover,
}));

import { DatabaseViewControls } from '../../../../src/tools/database/database-view-controls';
import type { ViewControlsHost } from '../../../../src/tools/database/database-view-controls';
import type { DatabaseViewConfig } from '../../../../src/tools/database/types';

const setup = (): DatabaseViewControls => {
  const view = { id: 'v1', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] } as DatabaseViewConfig;
  const host: ViewControlsHost = {
    i18n: { t: (key: string) => key },
    fallback: { get: () => undefined, set: () => undefined },
    savedView: () => view,
    schema: () => [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    rowCount: () => 5,
    locked: () => false,
    readOnly: () => false,
    viewCount: () => 1,
    layouts: ['table'],
    updateView: vi.fn(),
    setLayout: vi.fn(),
    setLocked: vi.fn(),
    duplicateView: vi.fn(),
    deleteView: vi.fn(),
    copyViewLink: vi.fn(),
    groups: () => [],
    rerender: vi.fn(),
  };
  const controls = new DatabaseViewControls(host);

  document.body.append(controls.toolbar);

  return controls;
};

const hintFor = (testId: string): unknown => {
  const button = document.querySelector(`[data-blok-testid="${testId}"]`);
  const call = onHover.mock.calls.find(([element]) => element === button);

  return call?.[1];
};

describe('database toolbar hints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['database-toolbar-filter', 'tools.database.settingsFilter'],
    ['database-toolbar-sort', 'tools.database.settingsSort'],
    ['database-toolbar-search', 'tools.database.searchLabel'],
    ['database-toolbar-settings', 'tools.database.settingsTitle'],
    ['database-toolbar-automations', 'tools.database.automationTitle'],
    ['database-toolbar-autofill', 'tools.database.aiAutofill'],
    ['database-toolbar-minimize', 'tools.database.filterBarMinimize'],
  ])('%s shows its name on hover', (testId, label) => {
    setup();

    expect(hintFor(testId)).toBe(label);
  });

  it('passes no delay of its own, so the shared hint delay applies', () => {
    setup();

    for (const [, , options] of onHover.mock.calls) {
      expect(options?.delay).toBeUndefined();
    }
  });
});
