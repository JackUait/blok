import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderCalendarViewPreview,
  renderFeedViewPreview,
  renderFormPreview,
  renderGalleryViewPreview,
  renderListViewPreview,
  renderTimelineViewPreview,
} from '../../../../src/tools/database/preview';

// trim: the icon's svg markup adds whitespace around a tab label.
const texts = (root: HTMLElement, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// research/28 §3: each "/" view entry's card draws the view it creates, under its seeded name.
describe('database "/" entry previews', () => {
  it.each([
    ['gallery', renderGalleryViewPreview, 'Gallery view', '[data-gallery-card]'],
    ['list', renderListViewPreview, 'List view', '[data-list-row]'],
    ['feed', renderFeedViewPreview, 'Feed view', '[data-feed-card]'],
    ['calendar', renderCalendarViewPreview, 'Calendar view', '[data-day]'],
    ['timeline', renderTimelineViewPreview, 'Timeline view', '[data-bar]'],
    ['form', renderFormPreview, 'Form builder', '[data-form-question]'],
  ] as const)('%s: a database drawing whose active tab is its first view', (_, render, tab, part) => {
    const root = render();

    expect(root.getAttribute('data-blok-preview')).toBe('database');
    expect(texts(root, '[data-tab][data-active]')).toEqual([tab]);
    expect(root.querySelector('[data-tab][data-active] [data-icon] svg')).not.toBeNull();
    expect(root.querySelectorAll(part).length).toBeGreaterThan(0);
  });

  it('gallery cards show a cover, the title, a Tags pill and the Created date', () => {
    const card = renderGalleryViewPreview().querySelector('[data-gallery-card]');

    expect(card?.querySelector('[data-gallery-cover]')).not.toBeNull();
    expect(card?.querySelector('[data-gallery-title]')?.textContent).toBe('Trip notes');
    expect(card?.querySelector('[data-props] > [data-pill] + [data-muted]')?.textContent).toBe('Sep 3');
  });

  it('list rows put Tags before Created, as the List view seed orders them', () => {
    const row = renderListViewPreview().querySelector('[data-list-row]');

    expect(row?.querySelector('[data-props]')?.firstElementChild?.hasAttribute('data-pill')).toBe(true);
    expect(row?.querySelector('[data-props]')?.lastElementChild?.hasAttribute('data-muted')).toBe(true);
  });

  it('feed cards stack the byline, the title and the body, as the real feed card does', () => {
    const card = renderFeedViewPreview().querySelector('[data-feed-card]');

    expect([...(card?.children ?? [])].map((child) => [...child.getAttributeNames()].find((name) => name.startsWith('data-feed')))).toEqual([
      'data-feed-byline', 'data-feed-title', 'data-feed-line',
    ]);
  });

  it('calendar draws a week header and three weeks with today marked once', () => {
    const root = renderCalendarViewPreview();

    expect(texts(root, '[data-weekday]')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(root.querySelectorAll('[data-day]')).toHaveLength(21);
    expect(texts(root, '[data-day][data-today] [data-day-number]')).toEqual(['20']);
    expect(root.querySelectorAll('[data-day][data-weekend]')).toHaveLength(6);
  });

  it('timeline draws the three sample cards in order', () => {
    expect(texts(renderTimelineViewPreview(), '[data-bar]')).toEqual(['Card 1', 'Card 2', 'Card 3']);
  });

  it('form shows Form builder and Responses tabs, and Question 2 with three options', () => {
    const root = renderFormPreview();

    expect(texts(root, '[data-tab]')).toEqual(['Form builder', 'Responses']);
    expect(texts(root, '[data-form-label]')).toEqual(['Question 1', 'Question 2']);
    expect(texts(root, '[data-form-option]')).toEqual(['Option 1', 'Option 2', 'Option 3']);
  });
});
