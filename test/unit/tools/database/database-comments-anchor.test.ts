import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltInCommentsUi } from '../../../../src/tools/database/database-comments';
import type { API } from '../../../../types';

const api = {
  events: { on: vi.fn(), off: vi.fn() },
  i18n: { t: (key: string) => key },
  tools: { getBlockTools: () => [{ name: 'database-comment' }] },
  config: {},
  blocks: { getChildren: () => [], getById: () => ({ id: 'r1' }) },
} as unknown as API;

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  new DOMRect(left, top, width, height);

const commentsUi = (): BuiltInCommentsUi => new BuiltInCommentsUi({
  api,
  locale: () => 'en',
  me: () => null,
  personName: () => undefined,
  permitted: () => true,
  readOnly: () => false,
  onChange: vi.fn(),
});

const box = (): HTMLElement => {
  const popover = document.querySelector<HTMLElement>('[data-blok-popover-custom-class~="blok-database-comment-box"]');

  if (popover === null) throw new Error('no comment box');

  return popover;
};

describe('comment box from a calendar event menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  // notion-motion.md Round 61 §2: Notion anchors it to the week row, 4 under the week,
  // centred on the week's right edge; not to the event.
  it('sits 4 under the week row, centred on its right edge', () => {
    const week = document.createElement('div');
    const event = document.createElement('div');

    week.setAttribute('data-blok-database-calendar-week', '');
    event.setAttribute('data-blok-database-calendar-event', '');
    week.appendChild(event);
    document.body.appendChild(week);
    vi.spyOn(week, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 700, 124));
    vi.spyOn(event, 'getBoundingClientRect').mockReturnValue(rect(400, 130, 86, 28));

    const ui = commentsUi();

    ui.open('r1', undefined, event);

    expect(box().style.top).toBe('228px');
    expect(box().style.left).toBe('700px');
    ui.destroy();
  });
});
