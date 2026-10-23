import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as icons from '../../../../src/components/icons';
import { DatabaseTool } from '../../../../src/tools/database';
import { VIEW_ICONS } from '../../../../src/tools/database/database-tab-bar';

describe('"/" Database section glyphs drawn after Notion (findings-creation N02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const iconOf = (name: string): string | undefined =>
    (DatabaseTool.toolbox as Array<{ name: string; icon?: string }>).find((entry) => entry.name === name)?.icon;

  it('draws Feed, Calendar, Timeline and Form with their Notion glyphs', () => {
    expect(iconOf('feedView')).toBe(icons.IconViewFeed);
    expect(iconOf('calendarView')).toBe(icons.IconViewCalendar);
    expect(iconOf('timelineView')).toBe(icons.IconViewTimeline);
    expect(iconOf('databaseForm')).toBe(icons.IconViewForm);
  });

  it('gives Database - Inline and Linked view their own glyphs', () => {
    expect(iconOf('database')).toBe(icons.IconDatabaseInline);
    expect(iconOf('linkedDatabase')).toBe(icons.IconDatabaseLinked);
  });

  it('uses the same view glyphs for the view tabs', () => {
    expect(VIEW_ICONS.feed).toBe(icons.IconViewFeed);
    expect(VIEW_ICONS.calendar).toBe(icons.IconViewCalendar);
    expect(VIEW_ICONS.timeline).toBe(icons.IconViewTimeline);
    expect(VIEW_ICONS.form).toBe(icons.IconViewForm);
  });
});
