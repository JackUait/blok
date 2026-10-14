import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const describeDatabase = BUILT_IN_BLOCK_DESCRIPTIONS.database;

const validate = (data: Record<string, unknown>): unknown[] => {
  if (typeof describeDatabase !== 'function') {
    throw new Error('database must be discoverable.');
  }

  return validateAgainst(describeDatabase({}).data, data);
};

const view = (extra: Record<string, unknown>): Record<string, unknown> => ({
  name: 'View',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...extra,
});

describe('database schema: Tier 3 (D6) data slots', () => {
  it('accepts saved native automation definitions without allowing unknown fields', () => {
    const data = {
      activeViewId: 'v',
      schema: [
        { id: 'title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
        { id: 'signal', name: 'Signal', type: 'text', position: 'a2' },
        { id: 'result', name: 'Result', type: 'text', position: 'a3' },
      ],
      views: [view({ id: 'v', type: 'table' })],
      automations: {
        version: 1,
        definitions: [
          {
            id: 'added',
            name: 'Added row',
            status: 'active',
            scope: { type: 'database' },
            triggerMode: 'any',
            triggers: [{ id: 'page', type: 'pageAdded' }],
            actions: [{ id: 'mark', type: 'editProperty', target: 'triggerRow', propertyId: 'result', value: 'ran' }],
          },
          {
            id: 'edited',
            name: 'Edited row',
            status: 'paused',
            scope: { type: 'view', viewId: 'v' },
            triggerMode: 'all',
            triggers: [
              { id: 'notes', type: 'propertyEdited', propertyId: 'notes' },
              { id: 'signal', type: 'propertyEdited', propertyId: 'signal' },
            ],
            actions: [{ id: 'mark', type: 'editProperty', target: 'triggerRow', propertyId: 'result', value: 'ran' }],
          },
        ],
      },
    };

    expect(validate(data)).toEqual([]);
    expect(validate({ ...data, unexpected: true }).length).toBeGreaterThan(0);
    expect(validate({
      ...data,
      automations: {
        ...data.automations,
        definitions: data.automations.definitions.map((definition) => ({ ...definition, unexpected: true })),
      },
    }).length).toBeGreaterThan(0);
    expect(validate({
      ...data,
      automations: { ...data.automations, version: 2 },
    }).length).toBeGreaterThan(0);
  });

  it('accepts place and verification properties, an autofill setting and form, map and dashboard views', () => {
    expect(validate({
      activeViewId: 'form',
      schema: [
        { id: 'name', name: 'Name', type: 'title', position: 'a0' },
        { id: 'where', name: 'Where', type: 'place', position: 'a1' },
        { id: 'check', name: 'Verified', type: 'verification', position: 'a2' },
        {
          id: 'summary',
          name: 'Summary',
          type: 'text',
          position: 'a3',
          autofill: { mode: 'translate', instruction: 'Short', language: 'fr', onCreate: true, onEdit: false },
        },
      ],
      views: [
        view({
          id: 'form',
          type: 'form',
          properties: [{ id: 'where', visible: true, required: true, description: 'Your office' }],
          form: { closed: false, anonymous: true, submitLabel: 'Send', confirmation: 'Thanks' },
        }),
        view({ id: 'map', type: 'map', mapBy: 'where' }),
        view({
          id: 'dash',
          type: 'dashboard',
          dashboard: { rows: [{ id: 'r1', height: 320, widgets: [{ id: 'w1', viewId: 'map', width: 6 }] }] },
        }),
        view({ id: 'cal', type: 'calendar', calendarSync: { enabled: true, calendarId: 'team' }, dataSourceId: 'other-db' }),
      ],
    })).toEqual([]);
  });

  it('accepts dashboard widget database references while rejecting unknown widget keys', () => {
    const local = { id: 'local', viewId: 'table', width: 6 };
    const foreign = { id: 'foreign', databaseId: 'other-db', viewId: 'table', width: 6 };
    const data = {
      activeViewId: 'dash',
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [view({
        id: 'dash',
        type: 'dashboard',
        dashboard: { rows: [{ id: 'row', widgets: [local, foreign] }] },
      })],
    };

    expect(validate(data)).toEqual([]);
    expect(validate({
      ...data,
      views: [view({
        id: 'dash',
        type: 'dashboard',
        dashboard: { rows: [{ id: 'row', widgets: [{ ...foreign, unexpected: true }] }] },
      })],
    }).length).toBeGreaterThan(0);
    expect(validate({
      ...data,
      views: [view({
        id: 'dash',
        type: 'dashboard',
        dashboard: { rows: [{ id: 'row', widgets: [{ ...local, unexpected: true }] }] },
      })],
    }).length).toBeGreaterThan(0);
  });

  it('rejects a dashboard widget wider than the 12-column grid', () => {
    expect(validate({
      activeViewId: 'dash',
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [view({ id: 'dash', type: 'dashboard', dashboard: { rows: [{ id: 'r1', widgets: [{ id: 'w1', viewId: 'x', width: 13 }] }] } })],
    }).length).toBeGreaterThan(0);
  });

  it('rejects an autofill setting with an unknown mode', () => {
    expect(validate({
      activeViewId: 'v',
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0', autofill: { mode: 'guess' } }],
      views: [view({ id: 'v', type: 'table' })],
    }).length).toBeGreaterThan(0);
  });
});

describe('database schema: row page layout tabs', () => {
  it('accepts the tabs block id on the title property', () => {
    const data = {
      activeViewId: 'v',
      schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0', pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'tabs-1' }],
      views: [view({ id: 'v', type: 'table' })],
    };

    expect(validate(data)).toEqual([]);
  });
});

describe('database schema: AI Autofill page content trigger', () => {
  it('accepts onEditContent on a property autofill setting', () => {
    const data = {
      activeViewId: 'v',
      schema: [
        { id: 'title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'summary', name: 'Summary', type: 'text', position: 'a1', autofill: { mode: 'summary', onEditContent: true } },
      ],
      views: [view({ id: 'v', type: 'table' })],
    };

    expect(validate(data)).toEqual([]);
  });
});
